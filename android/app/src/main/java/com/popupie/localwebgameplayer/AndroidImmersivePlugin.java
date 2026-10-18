package com.popupie.localwebgameplayer;

import android.app.Activity;
import android.graphics.Color;
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
    private void apply(final boolean immersive, final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity is not available");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                // 刘海/挖孔区域露出的是窗口背景：游戏中用黑色，游戏库用深蓝色
                window.getDecorView().setBackgroundColor(immersive ? Color.BLACK : Color.parseColor("#0F172A"));
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
                controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (immersive) {
                    controller.hide(WindowInsetsCompat.Type.systemBars());
                } else {
                    controller.show(WindowInsetsCompat.Type.systemBars());
                }
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }

    @PluginMethod
    public void enter(PluginCall call) {
        apply(true, call);
    }

    @PluginMethod
    public void exit(PluginCall call) {
        apply(false, call);
    }
}
