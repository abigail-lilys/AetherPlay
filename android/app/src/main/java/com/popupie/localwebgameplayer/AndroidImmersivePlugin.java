package com.popupie.localwebgameplayer;

import android.app.Activity;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidImmersive")
public class AndroidImmersivePlugin extends Plugin {
    @PluginMethod
    public void enter(PluginCall call) {
        applyImmersive(true, call);
    }

    @PluginMethod
    public void exit(PluginCall call) {
        applyImmersive(false, call);
    }

    private void applyImmersive(boolean immersive, PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity is not available");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                WindowCompat.setDecorFitsSystemWindows(window, !immersive);
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
                controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
                if (immersive) {
                    controller.hide(WindowInsetsCompat.Type.systemBars());
                } else {
                    controller.show(WindowInsetsCompat.Type.systemBars());
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not change Android system bars: " + error.getMessage(), error);
            }
        });
    }
}
