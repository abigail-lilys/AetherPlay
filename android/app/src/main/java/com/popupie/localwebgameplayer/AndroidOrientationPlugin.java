package com.popupie.localwebgameplayer;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidOrientation")
public class AndroidOrientationPlugin extends Plugin {
    @PluginMethod
    public void setOrientation(PluginCall call) {
        String value = call.getString("orientation", "landscape");
        final boolean portrait;
        if ("portrait".equalsIgnoreCase(value)) {
            portrait = true;
        } else if ("landscape".equalsIgnoreCase(value)) {
            portrait = false;
        } else {
            call.reject("Orientation must be 'portrait' or 'landscape'");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android activity is not available");
            return;
        }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(portrait
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
            JSObject result = new JSObject();
            result.put("orientation", portrait ? "portrait" : "landscape");
            call.resolve(result);
        });
    }
}
