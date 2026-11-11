package com.popupie.localwebgameplayer;

import android.os.Bundle;
import android.os.Build;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidFolderPickerPlugin.class);
        registerPlugin(AndroidOrientationPlugin.class);
        registerPlugin(AndroidImmersivePlugin.class);
        // Capacitor must initialize its LocalServer first.
        super.onCreate(savedInstanceState);
        this.bridge.setWebViewClient(new GameWebViewClient(this.bridge));

        // AETHERPLAY_SAF_SERVICEWORKER_CLIENT_ORDER_FIX_V1
        // Register after Capacitor to prevent its handler from overwriting ours.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            final android.content.Context appContext = getApplicationContext();
            final com.getcapacitor.Bridge capacitorBridge = this.bridge;
            ServiceWorkerController.getInstance().setServiceWorkerClient(
                new ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(
                        WebResourceRequest request
                    ) {
                        WebResourceResponse response =
                            GameWebViewClient.interceptAndroidGameAsset(
                                appContext, request
                            );
                        if (response != null) {
                            return GameWebViewClient.addIsolationHeaders(
                                request, response
                            );
                        }

                        return GameWebViewClient.addIsolationHeaders(
                            request,
                            capacitorBridge.getLocalServer()
                                .shouldInterceptRequest(request)
                        );
                    }
                }
            );
        }

        // AETHERPLAY_COI_RELOAD_AFTER_CLIENT_INSTALL_V1
        // BridgeActivity loads appUrl inside super.onCreate() before this
        // subclass installs GameWebViewClient. Reload once so the top-level
        // document is fetched through the COOP/COEP-aware client.
        this.bridge.reload();

        // Consume Android navigation Back and edge-swipe while a game is active.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (isGameActive()) {
                    return;
                }

                // On the library screen, allow Capacitor's normal Back behavior.
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }
        });
    }

    private boolean isGameActive() {
        if (this.bridge == null || this.bridge.getWebView() == null) {
            return false;
        }
        String title = this.bridge.getWebView().getTitle();
        return title != null && title.startsWith("__AETHERPLAY_GAME_ACTIVE__:");
    }
}
