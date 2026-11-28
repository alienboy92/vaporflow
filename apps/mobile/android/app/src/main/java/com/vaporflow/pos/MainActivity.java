package com.vaporflow.pos;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(AndroidUpdate.class);
        super.onCreate(state);
    }
}
