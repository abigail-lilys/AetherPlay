package com.popupie.localwebgameplayer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidFolderPickerPlugin.class);
        registerPlugin(AndroidOrientationPlugin.class);
        registerPlugin(AndroidImmersivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
