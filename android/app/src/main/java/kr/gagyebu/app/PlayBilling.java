package kr.gagyebu.app;

import android.app.Activity;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONObject;

import java.util.Collections;
import java.util.List;

/** 구글 플레이 정기 결제: 결제 화면을 띄우고, 끝나면 웹 화면(onPlayPurchase)에 알려요. 진짜인지는 서버(play-verify)가 확인해요. */
class PlayBilling {
    interface Js { void run(String code); }
    final Activity act; final Js js; BillingClient client;

    PlayBilling(Activity act, Js js) {
        this.act = act; this.js = js;
        client = BillingClient.newBuilder(act)
            .setListener((res, purchases) -> {
                if (res.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) report(purchases, false);
                else if (res.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) js.run("window.__toast && __toast('결제를 취소했어요')");
                else js.run("window.__toast && __toast(" + JSONObject.quote("결제를 마치지 못했어요 (" + res.getResponseCode() + ")") + ")");
            })
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    void ready(Runnable then) {
        if (client.isReady()) { then.run(); return; }
        client.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult r) {
                if (r.getResponseCode() == BillingClient.BillingResponseCode.OK) then.run();
                else js.run("window.__toast && __toast('구글 플레이 결제를 쓸 수 없어요. 플레이스토어에서 받은 앱인지 확인해 주세요')");
            }
            @Override public void onBillingServiceDisconnected() { }
        });
    }

    void buy(String productId) {
        ready(() -> {
            QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(
                QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(BillingClient.ProductType.SUBS).build())).build();
            client.queryProductDetailsAsync(q, (r, res) -> {
                List<ProductDetails> list = res == null ? null : res.getProductDetailsList();
                if (list == null || list.isEmpty() || list.get(0).getSubscriptionOfferDetails() == null || list.get(0).getSubscriptionOfferDetails().isEmpty()) {
                    js.run("window.__toast && __toast('구독 상품을 찾지 못했어요. 잠시 뒤 다시 시도해 주세요')"); return;
                }
                ProductDetails pd = list.get(0);
                String offer = pd.getSubscriptionOfferDetails().get(0).getOfferToken();
                BillingFlowParams fp = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(
                    BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(pd).setOfferToken(offer).build())).build();
                act.runOnUiThread(() -> client.launchBillingFlow(act, fp));
            });
        });
    }

    /** 이미 산 구독이 있으면 다시 알려요(폰을 바꿨거나 앱을 다시 깔았을 때) */
    void restore() {
        ready(() -> client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
            (r, list) -> { if (list != null && !list.isEmpty()) report(list, true); }));
    }

    void report(List<Purchase> purchases, boolean silent) {
        for (Purchase p : purchases) {
            if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
            try {
                JSONObject o = new JSONObject();
                o.put("productId", p.getProducts().isEmpty() ? "" : p.getProducts().get(0));
                o.put("purchaseToken", p.getPurchaseToken());
                o.put("silent", silent);
                js.run("window.onPlayPurchase && window.onPlayPurchase(" + JSONObject.quote(o.toString()) + ")");
            } catch (Exception ignored) { }
            // 서버가 확인(acknowledge)하지만, 혹시 몰라 앱에서도 확인해요
            if (!p.isAcknowledged()) client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), r -> { });
        }
    }
}
