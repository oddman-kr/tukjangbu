package kr.gagyebu.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/** 앱이 꺼져 있어도 몇 시간마다 서버에 물어보고, 새 소식이 있으면 휴대폰 알림을 띄워요. */
public class AlertWorker extends Worker {
    static final String PREFS = "notify", CHANNEL = "tuk_alerts", WORK = "tuk_alert_check";

    public AlertWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void configure(Context ctx, String json) {
        try {
            JSONObject o = new JSONObject(json);
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit().putBoolean("on", o.optBoolean("on")).putString("url", o.optString("url"))
                .putString("pin", o.optString("pin")).putString("me", o.optString("me")).putString("off", "," + o.optString("off") + ",").apply();
            WorkManager wm = WorkManager.getInstance(ctx);
            if (o.optBoolean("on")) {
                Constraints cs = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
                PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(AlertWorker.class, 2, TimeUnit.HOURS).setConstraints(cs).build();
                wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, req);
            } else wm.cancelUniqueWork(WORK);
        } catch (Exception ignored) { }
    }

    @NonNull @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!sp.getBoolean("on", false)) return Result.success();
        String url = sp.getString("url", ""), pin = sp.getString("pin", ""), me = sp.getString("me", "");
        if (url.isEmpty() || pin.isEmpty()) return Result.success();
        try {
            JSONObject body = new JSONObject();
            body.put("pin", pin); body.put("action", "alerts");
            JSONObject pl = new JSONObject(); pl.put("who", me); pl.put("since", sp.getString("since", ""));
            body.put("payload", pl);
            String res = post(url, body.toString());
            JSONArray list = new JSONObject(res).optJSONArray("alerts");
            Set<String> seen = new HashSet<>(sp.getStringSet("seen", new HashSet<>()));
            boolean first = !sp.getBoolean("primed", false);
            if (list != null) {
                createChannel(ctx);
                for (int i = 0; i < list.length(); i++) {
                    JSONObject a = list.getJSONObject(i);
                    String id = a.optString("id");
                    if (id.isEmpty() || seen.contains(id)) continue;
                    seen.add(id);
                    String kind = id.indexOf('_') > 0 ? id.substring(0, id.indexOf('_')) : id;
                    if (sp.getString("off", ",").contains("," + kind + ",")) continue; // 사용자가 끈 알림
                    if (!first) show(ctx, id.hashCode(), a.optString("title"), a.optString("body"));
                }
            }
            if (seen.size() > 300) seen = new HashSet<>(); // 너무 커지면 비워요
            sp.edit().putStringSet("seen", seen).putBoolean("primed", true)
                .putString("since", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US) {{ setTimeZone(java.util.TimeZone.getTimeZone("UTC")); }}.format(new java.util.Date()))
                .apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    static String post(String url, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(20000); c.setReadTimeout(30000);
        c.setRequestMethod("POST"); c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
        try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        if (code >= 300 && code < 400) { // Apps Script는 결과를 다른 주소로 넘겨줘요
            String loc = c.getHeaderField("Location"); c.disconnect();
            HttpURLConnection g = (HttpURLConnection) new URL(loc).openConnection();
            g.setConnectTimeout(20000); g.setReadTimeout(30000);
            return read(g.getInputStream());
        }
        return read(c.getInputStream());
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) > 0) bo.write(b, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "툭장부 알림", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("용돈, 정기 지출, 사 주세요 요청 소식");
            ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
    }

    static void show(Context ctx, int id, String title, String body) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("gagyebu://open"), ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder nb = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat).setColor(0xFF0F766E)
            .setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true).setContentIntent(pi);
        try { NotificationManagerCompat.from(ctx).notify(id, nb.build()); } catch (SecurityException ignored) { }
    }
}
