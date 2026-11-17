package kr.gagyebu.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** 홈 화면 위젯: 이번 달 지출 · 남은 예산 + 바로 말로 입력 */
public class SpendWidget extends AppWidgetProvider {

    static final String PREFS = "widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static void save(Context ctx, String json) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("data", json).apply();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, SpendWidget.class));
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONObject o = new JSONObject(sp.getString("data", "{}"));
            if (o.has("spent")) {
                v.setTextViewText(R.id.w_title, o.optString("title", "이번 달 지출"));
                v.setTextViewText(R.id.w_spent, o.optString("spent", "-"));
                v.setTextViewText(R.id.w_sub, o.optString("sub", ""));
                v.setProgressBar(R.id.w_bar, 100, Math.max(0, Math.min(100, o.optInt("pct", 0))), false);
            }
        } catch (Exception ignored) { }
        v.setOnClickPendingIntent(R.id.w_root, open(ctx, "gagyebu://open", 1));
        v.setOnClickPendingIntent(R.id.w_mic, open(ctx, "gagyebu://open?voice=1", 2));
        return v;
    }

    static PendingIntent open(Context ctx, String uri, int req) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(uri), ctx, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
