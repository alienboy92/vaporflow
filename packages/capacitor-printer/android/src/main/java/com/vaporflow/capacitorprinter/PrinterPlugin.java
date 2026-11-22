package com.vaporflow.capacitorprinter;

import android.content.Context;
import android.graphics.Color;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Prints a complete HTML document through Android's PrintManager. Used for
 * receipts (80 mm CSS) and A4 label sheets. Capacitor's WebView does not
 * implement window.print(), so the page is rendered in a hidden WebView and
 * handed to the system print service as a print document adapter.
 */
@CapacitorPlugin(name = "Printer")
public class PrinterPlugin extends Plugin {

    private WebView printWebView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String documentName = call.getString("documentName", "Document");
        if (html == null || html.isEmpty()) {
            call.reject("printHtml requires an html document");
            return;
        }

        getActivity().runOnUiThread(() -> {
            detachPrintWebView();

            final boolean[] finished = {false};
            final WebView webView = new WebView(getActivity());
            webView.setBackgroundColor(Color.WHITE);
            webView.getSettings().setJavaScriptEnabled(false);
            webView.getSettings().setAllowFileAccess(false);
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    if (finished[0]) return;
                    finished[0] = true;

                    PrintManager printManager =
                        (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null) {
                        call.reject("The system print service is not available on this device.");
                        return;
                    }
                    CharSequence appName = getActivity()
                        .getApplicationInfo()
                        .loadLabel(getActivity().getPackageManager());
                    String jobName = appName + " " + documentName;
                    PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
                    try {
                        printManager.print(
                            jobName,
                            adapter,
                            new PrintAttributes.Builder()
                                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                                .build()
                        );
                        call.resolve();
                    } catch (RuntimeException error) {
                        call.reject("Could not open the print dialog: " + error.getMessage());
                    }
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    call.reject("Could not prepare the document for printing.");
                }
            });

            printWebView = webView;
            getActivity().addContentView(webView, new ViewGroup.LayoutParams(1, 1));
            webView.setVisibility(View.INVISIBLE);
            webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }

    @Override
    protected void handleOnDestroy() {
        detachPrintWebView();
        super.handleOnDestroy();
    }

    /** Removes and destroys the WebView used for the previous print job. */
    private void detachPrintWebView() {
        if (printWebView == null) return;
        ViewGroup parent = (ViewGroup) printWebView.getParent();
        if (parent != null) parent.removeView(printWebView);
        printWebView.destroy();
        printWebView = null;
    }
}
