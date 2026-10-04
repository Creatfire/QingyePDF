package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

/**
 * Writes what a PrintDocumentAdapter produces straight into a PDF file, without the system print
 * dialog. It lives in android.print because the framework's result callbacks can only be
 * subclassed from this package.
 */
public final class QingyePdfPrinter {

    public interface Callback {
        void done(String error);
    }

    private QingyePdfPrinter() {}

    public static void print(final PrintDocumentAdapter adapter, final PrintAttributes attributes, final File target, final Callback callback) {
        adapter.onLayout(
            null,
            attributes,
            null,
            new PrintDocumentAdapter.LayoutResultCallback() {
                @Override
                public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                    final ParcelFileDescriptor descriptor;
                    try {
                        descriptor = ParcelFileDescriptor.open(
                            target,
                            ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE
                        );
                    } catch (Exception error) {
                        callback.done(String.valueOf(error.getMessage()));
                        return;
                    }
                    adapter.onWrite(
                        new PageRange[] { PageRange.ALL_PAGES },
                        descriptor,
                        new CancellationSignal(),
                        new PrintDocumentAdapter.WriteResultCallback() {
                            @Override
                            public void onWriteFinished(PageRange[] pages) {
                                close(descriptor);
                                adapter.onFinish();
                                callback.done(null);
                            }

                            @Override
                            public void onWriteFailed(CharSequence error) {
                                close(descriptor);
                                adapter.onFinish();
                                callback.done(error == null ? "write failed" : error.toString());
                            }

                            @Override
                            public void onWriteCancelled() {
                                close(descriptor);
                                adapter.onFinish();
                                callback.done("cancelled");
                            }
                        }
                    );
                }

                @Override
                public void onLayoutFailed(CharSequence error) {
                    callback.done(error == null ? "layout failed" : error.toString());
                }

                @Override
                public void onLayoutCancelled() {
                    callback.done("cancelled");
                }
            },
            null
        );
    }

    private static void close(ParcelFileDescriptor descriptor) {
        try {
            descriptor.close();
        } catch (Exception ignored) {}
    }
}
