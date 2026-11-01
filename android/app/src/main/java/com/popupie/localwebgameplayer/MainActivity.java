package com.popupie.localwebgameplayer;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidFolderPickerPlugin.class);
        registerPlugin(AndroidOrientationPlugin.class);
        registerPlugin(AndroidImmersivePlugin.class);
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
