package kr.gagyebu.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.app.KeyguardManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.view.HapticFeedbackConstants;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import android.provider.MediaStore;
import android.webkit.ValueCallback;

import androidx.core.content.FileProvider;

import java.io.File;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.FrameLayout;
import android.graphics.Insets;
import android.view.Window;
import android.window.OnBackInvokedDispatcher;
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

    static final String HOME_V1 = "https://oddman-kr.github.io/tukjangbu/";
    static final String HOME_V2 = "https://oddman-kr.github.io/tukjangbu/v2/";
    PlayBilling billing;
    static final String HOST = "oddman-kr.github.io";
    static final int REQ_MIC = 7;
    static final int REQ_FILE = 8;
    static final int REQ_AUTH = 9;
    long versionCode = 1;

    ValueCallback<Uri[]> fileCallback;
    Uri cameraUri;

    WebView web;
    FrameLayout root;
    int navCss = 0;
    boolean darkIconsNow = true;
    SpeechRecognizer recognizer;
    boolean pendingStart = false;
    String pendingLang = "ko-KR";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 안드로이드 13+ : 새 뒤로가기 방식(안드로이드 16을 대상으로 하면 onBackPressed가 더는 불리지 않아요)
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        Window w = getWindow();
        // 화면 가장자리까지 그리고(안드로이드 15+ 기본 동작), 상태바·내비바·키보드 영역은 직접 비워 둔다
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 29) { w.setNavigationBarContrastEnforced(false); w.setStatusBarContrastEnforced(false); }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F6F5F1"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F6F5F1"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            int top, left, right, nav, ime;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets sb = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets im = ins.getInsets(WindowInsets.Type.ime());
                top = sb.top; left = sb.left; right = sb.right; nav = sb.bottom; ime = im.bottom;
            } else {
                top = ins.getSystemWindowInsetTop(); left = ins.getSystemWindowInsetLeft(); right = ins.getSystemWindowInsetRight();
                int b = ins.getSystemWindowInsetBottom();
                int big = Math.round(120 * getResources().getDisplayMetrics().density);
                ime = b > big ? b : 0; nav = b > big ? 0 : b;
            }
            boolean keyboard = ime > nav;
            v.setPadding(left, top, right, keyboard ? ime : 0);
            navCss = keyboard ? 0 : Math.round(nav / getResources().getDisplayMetrics().density);
            pushInsets();
            return ins;
        });
        applyBarIcons(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        try {
            versionCode = Build.VERSION.SDK_INT >= 28
                ? getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode()
                : getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
        } catch (Exception ignored) { }
        s.setUserAgentString(s.getUserAgentString() + " GagyebuApp/" + versionCode);

        web.addJavascriptInterface(new NativeSpeech(), "NativeSpeech");
        web.addJavascriptInterface(new NativeApp(), "NativeApp");
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.deny());
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return openFileChooser(callback, params);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) { pushInsets(); }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                if (isAuthUrl(u)) { openAuthTab(u.toString()); return true; }
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

    // 처음 켤 때는 로그인 버전. '예전 방식으로 쓰기'를 고르면 그걸 기억해요
    String home() { return getSharedPreferences("app", MODE_PRIVATE).getString("start", HOME_V2); }

    String urlFor(Intent intent) {
        Uri d = intent == null ? null : intent.getData();
        String q = d == null ? null : d.getQuery();
        String HOME = home();
        // 카카오·네이버·구글 로그인이 끝나면 tukjangbu://auth-callback#access_token=... 으로 돌아와요 (예전 앱과 겹치지 않게 주소를 바꿨어요)
        if (d != null && "tukjangbu".equals(d.getScheme()) && "auth-callback".equals(d.getHost())) {
            // 토큰은 주소 뒤 #(예전 방식) 또는 ?(로그인 완료 페이지에서 넘어올 때)에 있어요
            String f = d.getEncodedFragment();
            if (f == null || f.isEmpty()) f = d.getEncodedQuery();
            return HOME_V2 + "?app=1" + (f != null && !f.isEmpty() ? "#" + f : "");
        }
        if (q != null && q.contains("voice=1")) return HOME + "?voice=1&app=1";
        if (q != null && q.contains("manual=1")) return HOME + "?manual=1&app=1";
        return HOME + "?app=1";
    }

    static boolean isAuthUrl(Uri u) {
        String h = u.getHost() == null ? "" : u.getHost(), p = u.getPath() == null ? "" : u.getPath();
        return (h.endsWith("supabase.co") && (p.startsWith("/auth/v1/authorize") || p.startsWith("/functions/v1/naver-auth")))
            || h.equals("accounts.google.com") || h.equals("kauth.kakao.com") || h.equals("accounts.kakao.com") || h.equals("nid.naver.com");
    }

    // 구글은 앱 안 화면(WebView)에서 로그인을 막아서, 로그인은 크롬 탭으로 열어요
    void openAuthTab(String url) {
        try {
            new androidx.browser.customtabs.CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, Uri.parse(url));
        } catch (Exception e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
        }
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

    /** 뒤로가기: 먼저 화면(열린 창·다른 탭)에 물어보고, 처리할 게 없으면 앱을 뒤로 보냄(다시 열 때 빠름) */
    @Override
    public void onBackPressed() { handleBack(); }

    void handleBack() {
        web.evaluateJavascript("(function(){ try { return window.__onBack ? !!window.__onBack() : false; } catch(e) { return false; } })()", value -> {
            if ("true".equals(value)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
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


    void pushInsets() {
        if (web == null) return;
        web.evaluateJavascript("document.documentElement.style.setProperty('--sab','" + navCss + "px');document.documentElement.classList.add('native-app');", null);
    }

    void applyBarIcons(boolean darkIcons) {
        darkIconsNow = darkIcons;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(darkIcons ? mask : 0, mask);
            }
        } else {
            View d = getWindow().getDecorView();
            int f = d.getSystemUiVisibility();
            f = darkIcons ? (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            d.setSystemUiVisibility(f);
        }
    }

    /* ---------- 앱 기능: 진동, 상태바, 공유, 잠금 ---------- */

    void authDone(boolean ok, String reason) {
        authBusy = false;
        js0("window.__app && window.__app.authResult(" + ok + "," + JSONObject.quote(reason == null ? "" : reason) + ")");
    }

    PlayBilling playBilling() {
        if (billing == null) billing = new PlayBilling(this, this::js0);
        return billing;
    }

    void js0(final String code) {
        runOnUiThread(() -> web.evaluateJavascript("(function(){ try{ " + code + " }catch(e){} })()", null));
    }

    boolean deviceSecure() {
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        return km != null && km.isDeviceSecure();
    }

    boolean authBusy = false;

    void startAuth() {
        if (authBusy) return;
        authBusy = true;
        try {
            startAuthInner();
        } catch (Throwable e) {
            authBusy = false;
            authDone(false, "error: " + e.getMessage());
        }
    }

    void startAuthInner() {
        if (!deviceSecure()) { authBusy = false; authDone(false, "no-lock"); return; }
        if (Build.VERSION.SDK_INT >= 30) {
            BiometricPrompt bp = new BiometricPrompt.Builder(this)
                .setTitle("가계부 잠금 해제")
                .setSubtitle("지문, 얼굴 또는 화면 잠금으로 확인해 주세요")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();
            bp.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { authDone(true, ""); }
                @Override public void onAuthenticationError(int code, CharSequence msg) { authDone(false, String.valueOf(msg)); }
            });
        } else if (Build.VERSION.SDK_INT == 29) {
            BiometricPrompt bp = new BiometricPrompt.Builder(this)
                .setTitle("가계부 잠금 해제")
                .setDeviceCredentialAllowed(true)
                .build();
            bp.authenticate(new CancellationSignal(), getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult r) { authDone(true, ""); }
                @Override public void onAuthenticationError(int code, CharSequence msg) { authDone(false, String.valueOf(msg)); }
            });
        } else {
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            Intent i = km.createConfirmDeviceCredentialIntent("가계부 잠금 해제", "화면 잠금으로 확인해 주세요");
            if (i == null) { authDone(false, "no-lock"); return; }
            startActivityForResult(i, REQ_AUTH);
        }
    }

    void shareFile(String name, String mime, String text) {
        try {
            File dir = new File(getCacheDir(), "share");
            if (!dir.exists()) dir.mkdirs();
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            File f = new File(dir, safe);
            try (FileOutputStream out = new FileOutputStream(f)) {
                if (safe.endsWith(".csv")) out.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri u = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, u);
            send.putExtra(Intent.EXTRA_SUBJECT, safe);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(send, "내보내기"));
        } catch (Exception e) {
            js0("window.__app && window.__app.toast(" + JSONObject.quote("내보내기 실패: " + e.getMessage()) + ")");
        }
    }

    class NativeApp {
        @JavascriptInterface public long version() { return versionCode; }
        @JavascriptInterface public void vibrate() {
            runOnUiThread(() -> web.performHapticFeedback(Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY));
        }
        @JavascriptInterface public void statusBar(final String hex, final boolean darkIcons) {
            runOnUiThread(() -> {
                try {
                    int col = Color.parseColor(hex);
                    root.setBackgroundColor(col);
                    web.setBackgroundColor(col);
                    applyBarIcons(darkIcons);
                } catch (Exception ignored) { }
            });
        }
        @JavascriptInterface public boolean canLock() { return deviceSecure(); }
        @JavascriptInterface public void authenticate() { runOnUiThread(() -> startAuth()); }
        @JavascriptInterface public void share(final String name, final String mime, final String text) { runOnUiThread(() -> shareFile(name, mime, text)); }
        @JavascriptInterface public void setNotify(final String json) {
            try { AlertWorker.configure(getApplicationContext(), json); } catch (Exception ignored) { }
        }
        @JavascriptInterface public boolean notifyAllowed() {
            if (Build.VERSION.SDK_INT < 33) return true;
            return checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
        }
        @JavascriptInterface public void askNotify() {
            if (Build.VERSION.SDK_INT >= 33) runOnUiThread(() -> requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 77));
        }
        @JavascriptInterface public void setWidget(final String json) {
            try { SpendWidget.save(getApplicationContext(), json); } catch (Exception ignored) { }
        }
        @JavascriptInterface public void openAuth(final String url) { runOnUiThread(() -> openAuthTab(url)); }
        @JavascriptInterface public String authRedirect() { return "https://oddman-kr.github.io/tukjangbu/auth-return.html"; }
        @JavascriptInterface public void setStart(final String url) {
            if (url != null && (url.equals(HOME_V1) || url.equals(HOME_V2))) getSharedPreferences("app", MODE_PRIVATE).edit().putString("start", url).apply();
        }
        @JavascriptInterface public void buy(final String productId) { runOnUiThread(() -> playBilling().buy(productId)); }
        @JavascriptInterface public void restorePurchases() { runOnUiThread(() -> playBilling().restore()); }
        @JavascriptInterface public void openExternal(final String url) {
            runOnUiThread(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { } });
        }
    }

    /* ---------- 영수증 사진: 카메라 또는 앨범 ---------- */

    boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        cameraUri = null;
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        try {
            File dir = new File(getCacheDir(), "images");
            if (!dir.exists()) dir.mkdirs();
            File f = File.createTempFile("receipt_", ".jpg", dir);
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", f);
            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            camera = null;
        }
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("image/*");
        Intent target;
        if (params != null && params.isCaptureEnabled() && camera != null) {
            target = camera;
        } else {
            target = Intent.createChooser(pick, "영수증 사진");
            if (camera != null) target.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(target, REQ_FILE);
            return true;
        } catch (Exception e) {
            if (camera != null && target == camera) {
                try { startActivityForResult(Intent.createChooser(pick, "영수증 사진"), REQ_FILE); return true; } catch (Exception ignored) { }
            }
            fileCallback = null;
            return false;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_AUTH) { authDone(resultCode == RESULT_OK, resultCode == RESULT_OK ? "" : "canceled"); return; }
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) result = new Uri[]{data.getData()};
            else if (cameraUri != null) result = new Uri[]{cameraUri};
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
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
        if (recognizer != null) { try { recognizer.cancel(); } catch (Exception ignored) { } recognizer.destroy(); recognizer = null; }
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

    boolean retried = false;
    String lastLang = "ko-KR";

    class Listener implements RecognitionListener {
        boolean ended = false;
        String last = "";

        void finish() {
            if (ended) return;
            ended = true;
            js("__nsr.end()");
        }

        @Override public void onReadyForSpeech(Bundle params) { retried = false; js("__nsr.start()"); }
        @Override public void onBeginningOfSpeech() { }
        @Override public void onRmsChanged(float rmsdB) { }
        @Override public void onBufferReceived(byte[] buffer) { }
        @Override public void onEndOfSpeech() { }

        @Override public void onError(int error) {
            // 바로 전 인식이 아직 정리 중이면(바쁨) 한 번만 조용히 다시 시도
            if ((error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == 11) && !retried && last.isEmpty()) {
                retried = true; ended = true;
                web.postDelayed(() -> startRecognizer(lastLang), 450);
                return;
            }
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
            runOnUiThread(() -> { retried = false; lastLang = lang == null || lang.isEmpty() ? "ko-KR" : lang; startRecognizer(lastLang); });
        }
        @JavascriptInterface public void stop() { runOnUiThread(() -> stopRecognizer(false)); }
        @JavascriptInterface public void abort() {
            runOnUiThread(() -> { stopRecognizer(true); js("__nsr.end()"); });
        }
    }
}
