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
        // AETHERPLAY_ANDROID_SAF_STREAM_V1: intercept Service Worker fetches too.
        // Android's ServiceWorkerClient is separate from WebViewClient and is available on API 24+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            final android.content.Context appContext = getApplicationContext();
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                    return GameWebViewClient.interceptAndroidGameAsset(appContext, request);
                }
            });
        }
        super.onCreate(savedInstanceState);
        this.bridge.setWebViewClient(new GameWebViewClient(this.bridge));

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
