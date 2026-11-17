package kr.gagyebu.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;

/**
 * 우리집 가계부 안드로이드 앱.
 * 화면은 GitHub Pages의 웹앱을 그대로 띄우고(코드를 고치면 앱도 자동으로 최신이 됨),
 * 음성 인식만 휴대폰 자체 기능(SpeechRecognizer)으로 연결한다.
 */
public class MainActivity extends Activity {

    static final String HOME = "https://zkskslsk-del.github.io/gagyebu/";
    static final String HOST = "zkskslsk-del.github.io";
    static final int REQ_MIC = 7;

    WebView web;
    SpeechRecognizer recognizer;
    boolean pendingStart = false;
    String pendingLang = "ko-KR";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#0F766E"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F6F5F1"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " GagyebuApp/1");

        web.addJavascriptInterface(new NativeSpeech(), "NativeSpeech");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.deny());
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(urlFor(getIntent()));
    }

    String urlFor(Intent intent) {
        Uri d = intent == null ? null : intent.getData();
        String q = d == null ? null : d.getQuery();
        if (q != null && q.contains("voice=1")) return HOME + "?voice=1&app=1";
        if (q != null && q.contains("manual=1")) return HOME + "?manual=1&app=1";
        return HOME + "?app=1";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri d = intent.getData();
        if (d != null) web.loadUrl(urlFor(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        stopRecognizer(true);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        stopRecognizer(true);
        if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        web.destroy();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_MIC) return;
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingStart) {
            pendingStart = false;
            if (ok) startRecognizer(pendingLang);
            else { js("__nsr.error('not-allowed')"); js("__nsr.end()"); }
        }
    }

    /* ---------- 음성 인식 ---------- */

    void js(final String code) {
        runOnUiThread(() -> web.evaluateJavascript("window.__nsr && (function(){ try{ " + code + " }catch(e){} })()", null));
    }

    void startRecognizer(String lang) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingStart = true;
            pendingLang = lang;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("__nsr.error('service-not-allowed')");
            js("__nsr.end()");
            return;
        }
        if (recognizer != null) { recognizer.destroy(); recognizer = null; }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new Listener());
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        recognizer.startListening(i);
    }

    void stopRecognizer(boolean cancel) {
        if (recognizer == null) return;
        try { if (cancel) recognizer.cancel(); else recognizer.stopListening(); } catch (Exception ignored) { }
    }

    class Listener implements RecognitionListener {
        boolean ended = false;
        String last = "";

        void finish() {
            if (ended) return;
            ended = true;
            js("__nsr.end()");
        }

        @Override public void onReadyForSpeech(Bundle params) { js("__nsr.start()"); }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }

        @Override public void onError(int error) {
            String code;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "not-allowed"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: code = "no-speech"; break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                case SpeechRecognizer.ERROR_SERVER: code = "network"; break;
                case SpeechRecognizer.ERROR_CLIENT: code = "aborted"; break;
                default: code = "error-" + error;
            }
            if (!last.isEmpty()) { js("__nsr.result(" + JSONObject.quote(last) + ", true)"); }
            else js("__nsr.error('" + code + "')");
            finish();
        }

        @Override public void onResults(Bundle results) {
            ArrayList<String> r = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String t = (r != null && !r.isEmpty()) ? r.get(0) : last;
            if (t != null && !t.isEmpty()) js("__nsr.result(" + JSONObject.quote(t) + ", true)");
            else js("__nsr.error('no-speech')");
            finish();
        }

        @Override public void onPartialResults(Bundle partial) {
            ArrayList<String> r = partial.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            if (r != null && !r.isEmpty() && r.get(0) != null && !r.get(0).isEmpty()) {
                last = r.get(0);
                js("__nsr.result(" + JSONObject.quote(last) + ", false)");
            }
        }

        @Override public void onEvent(int eventType, Bundle params) { }
    }

    /** 웹 화면에서 window.NativeSpeech 로 부르는 함수들 */
    class NativeSpeech {
        @JavascriptInterface public boolean available() { return true; }
        @JavascriptInterface public void start(final String lang) {
            runOnUiThread(() -> startRecognizer(lang == null || lang.isEmpty() ? "ko-KR" : lang));
        }
        @JavascriptInterface public void stop() { runOnUiThread(() -> stopRecognizer(false)); }
        @JavascriptInterface public void abort() {
            runOnUiThread(() -> { stopRecognizer(true); js("__nsr.end()"); });
        }
    }
}
