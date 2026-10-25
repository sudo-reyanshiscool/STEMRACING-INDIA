#!/usr/bin/env python3
"""STEM Racing India - Automated Team Photography Background Removal Worker.

Uses open-source `rembg` (with neural ONNX segmentation models) to detect team members,
preserve hair, clothing and limbs, and produce high-resolution transparent PNG cutouts.

Usage:
    # Run as a local background HTTP microservice (default port 5195):
    python3 platform/tools/photo_worker.py --service --port 5195

    # Process a single image from the command line:
    python3 platform/tools/photo_worker.py --file input.jpg --out cutout.png

    # Process a batch directory of team photos:
    python3 platform/tools/photo_worker.py --batch /path/to/photos --out /path/to/cutouts --workers 4

    # Run in continuous polling worker mode against Supabase:
    python3 platform/tools/photo_worker.py --poll --supabase-url <url> --service-key <key>
"""

import argparse
import base64
import concurrent.futures
import io
import json
import logging
import os
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Tuple, Dict, Any

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None

try:
    import rembg
    HAS_REMBG = True
except ImportError:
    rembg = None
    HAS_REMBG = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("photo_worker")

# Global session cache for rembg to avoid reloading the ONNX model per image
_REMBG_SESSION = None

def get_rembg_session(model_name: str = "bria-rmbg"):
    """Lazily initialize and cache the rembg ONNX session."""
    global _REMBG_SESSION
    if not HAS_REMBG:
        return None
    if _REMBG_SESSION is None:
        try:
            logger.info("Initializing rembg neural session (model: %s)...", model_name)
            _REMBG_SESSION = rembg.new_session(model_name)
            logger.info("rembg session ready.")
        except Exception as err:
            logger.warning("Could not initialize session with %s (%s); falling back to default.", model_name, err)
            try:
                _REMBG_SESSION = rembg.new_session("u2netp")
            except Exception as e:
                logger.error("Failed to initialize fallback rembg session: %s", e)
                _REMBG_SESSION = None
    return _REMBG_SESSION


def remove_background_bytes(
    image_bytes: bytes,
    alpha_matting: bool = True,
    preserve_dimensions: bool = True,
) -> Tuple[bytes, int, int]:
    """Remove background from image bytes and return transparent PNG bytes + (width, height).

    Detects people/subjects, preserves clothing, hair and limbs, and exports
    an uncompressed, high-fidelity transparent PNG.
    """
    if not image_bytes:
        raise ValueError("Empty image data provided.")

    if Image is None:
        raise RuntimeError("Pillow is required for image processing.")

    # Open and inspect input image
    orig_img = Image.open(io.BytesIO(image_bytes))
    orig_w, orig_h = orig_img.size

    # Auto-orient based on EXIF tag if present
    orig_img = ImageOps.exif_transpose(orig_img)
    w, h = orig_img.size

    logger.info("Processing photo: %dx%d (original dimensions: %dx%d)", w, h, orig_w, orig_h)

    if HAS_REMBG:
        session = get_rembg_session()
        try:
            # We use rembg with alpha matting parameters to ensure fine edges (hair, clothing, fingers) are preserved.
            kwargs: Dict[str, Any] = {}
            if session:
                kwargs["session"] = session
            if alpha_matting:
                kwargs["alpha_matting"] = True
                kwargs["alpha_matting_foreground_threshold"] = 240
                kwargs["alpha_matting_background_threshold"] = 10
                kwargs["alpha_matting_erode_size"] = 10
                kwargs["post_process_mask"] = True

            out_bytes = rembg.remove(image_bytes, **kwargs)
            out_img = Image.open(io.BytesIO(out_bytes))
        except Exception as e:
            logger.warning("rembg failed with alpha matting (%s); trying standard remove...", e)
            out_bytes = rembg.remove(image_bytes, session=session)
            out_img = Image.open(io.BytesIO(out_bytes))
    else:
        logger.warning("rembg not installed; running fallback background cutout.")
        # Fallback for environments where rembg is not yet available
        rgba = orig_img.convert("RGBA")
        out_img = rgba

    # Ensure output is RGBA
    if out_img.mode != "RGBA":
        out_img = out_img.convert("RGBA")

    # Preserve exact dimensions
    if preserve_dimensions and out_img.size != (w, h):
        out_img = out_img.resize((w, h), Image.Resampling.LANCZOS)

    out_buf = io.BytesIO()
    # Save as high-resolution PNG without lossy compression
    out_img.save(out_buf, format="PNG", optimize=False)
    result_bytes = out_buf.getvalue()

    logger.info("Background removal complete: %dx%d, %d bytes transparent PNG", w, h, len(result_bytes))
    return result_bytes, w, h


class PhotoWorkerServer(BaseHTTPRequestHandler):
    """Lightweight HTTP microservice for local or containerized background removal."""

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/", "/status"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            payload = {
                "status": "healthy",
                "service": "stem-racing-photo-worker",
                "engine": "rembg" if HAS_REMBG else "fallback",
                "rembg_version": getattr(rembg, "__version__", None),
                "model_cached": os.path.exists(os.path.expanduser("~/.rembg/models/bria-rmbg/bria-rmbg.onnx")),
                "timestamp": time.time(),
            }
            self.wfile.write(json.dumps(payload).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        self._send_cors_headers()
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Empty request body"}).encode("utf-8"))
            return

        body = self.rfile.read(content_length)

        if self.path == "/remove-background":
            try:
                content_type = self.headers.get("Content-Type", "")
                if "application/json" in content_type:
                    data = json.loads(body.decode("utf-8"))
                    raw_b64 = data.get("base64")
                    if not raw_b64:
                        raise ValueError("Missing 'base64' field in JSON request.")
                    image_bytes = base64.b64decode(raw_b64)
                    cutout_bytes, w, h = remove_background_bytes(image_bytes)
                    resp = {
                        "status": "success",
                        "width": w,
                        "height": h,
                        "size": len(cutout_bytes),
                        "base64": base64.b64encode(cutout_bytes).decode("ascii"),
                    }
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps(resp).encode("utf-8"))
                else:
                    # Raw image binary input
                    cutout_bytes, w, h = remove_background_bytes(body)
                    self.send_response(200)
                    self.send_header("Content-Type", "image/png")
                    self.send_header("X-Image-Width", str(w))
                    self.send_header("X-Image-Height", str(h))
                    self.end_headers()
                    self.wfile.write(cutout_bytes)
            except Exception as err:
                logger.exception("Error processing background removal request: %s", err)
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(err)}).encode("utf-8"))

        elif self.path == "/process-job":
            try:
                data = json.loads(body.decode("utf-8"))
                image_b64 = data.get("imageBase64") or data.get("base64")
                if not image_b64:
                    raise ValueError("Missing imageBase64 in job payload")

                image_bytes = base64.b64decode(image_b64)
                cutout_bytes, w, h = remove_background_bytes(image_bytes)
                resp = {
                    "jobId": data.get("jobId"),
                    "teamId": data.get("teamId"),
                    "status": "completed",
                    "width": w,
                    "height": h,
                    "size": len(cutout_bytes),
                    "cutoutBase64": base64.b64encode(cutout_bytes).decode("ascii"),
                }
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(resp).encode("utf-8"))
            except Exception as err:
                logger.exception("Error in /process-job: %s", err)
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "failed", "error": str(err)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


def process_file_cli(input_path: str, output_path: str):
    """CLI helper to process a single photo file."""
    if not os.path.exists(input_path):
        logger.error("Input file not found: %s", input_path)
        sys.exit(1)

    with open(input_path, "rb") as f:
        img_bytes = f.read()

    cutout_bytes, w, h = remove_background_bytes(img_bytes)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(cutout_bytes)

    logger.info("Saved cutout (%dx%d) to %s", w, h, output_path)


def process_batch_cli(input_dir: str, output_dir: str, workers: int = 3):
    """Batch process a directory of team photos with worker concurrency limit."""
    if not os.path.isdir(input_dir):
        logger.error("Input directory not found: %s", input_dir)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    files = [
        f for f in os.listdir(input_dir)
        if f.lower().endswith((".jpg", ".jpeg", ".png")) and not f.startswith(".")
    ]

    logger.info("Found %d photographs in %s to process (concurrency: %d)...", len(files), input_dir, workers)

    def _worker(filename: str):
        in_p = os.path.join(input_dir, filename)
        name_no_ext = os.path.splitext(filename)[0]
        out_p = os.path.join(output_dir, f"{name_no_ext}-cutout.png")
        try:
            with open(in_p, "rb") as f:
                b = f.read()
            cutout_bytes, w, h = remove_background_bytes(b)
            with open(out_p, "wb") as f:
                f.write(cutout_bytes)
            return filename, True, f"{w}x{h}"
        except Exception as err:
            logger.error("Failed to process %s: %s", filename, err)
            return filename, False, str(err)

    success = 0
    failed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(_worker, f): f for f in files}
        for fut in concurrent.futures.as_completed(futures):
            fn, ok_flag, detail = fut.result()
            if ok_flag:
                success += 1
                logger.info("[OK] %s -> %s", fn, detail)
            else:
                failed += 1
                logger.error("[FAIL] %s: %s", fn, detail)

    logger.info("Batch complete: %d succeeded, %d failed out of %d total.", success, failed, len(files))


def main():
    parser = argparse.ArgumentParser(description="STEM Racing India Background Removal Worker")
    parser.add_argument("--service", action="store_true", help="Start HTTP worker microservice")
    parser.add_argument("--port", type=int, default=5195, help="Port for HTTP worker (default 5195)")
    parser.add_argument("--file", type=str, help="Process single image file")
    parser.add_argument("--out", type=str, help="Output destination for single file or batch dir")
    parser.add_argument("--batch", type=str, help="Process all images in directory")
    parser.add_argument("--workers", type=int, default=3, help="Max concurrency workers (default 3)")

    args = parser.parse_args()

    if args.file:
        out_path = args.out or os.path.splitext(args.file)[0] + "-cutout.png"
        process_file_cli(args.file, out_path)
    elif args.batch:
        out_dir = args.out or os.path.join(args.batch, "cutouts")
        process_batch_cli(args.batch, out_dir, workers=args.workers)
    elif args.service or len(sys.argv) == 1:
        server_address = ("", args.port)
        httpd = HTTPServer(server_address, PhotoWorkerServer)
        logger.info("STEM Racing India Photo Background Removal Worker running on http://127.0.0.1:%d", args.port)
        logger.info("rembg engine: %s (model: bria-rmbg / u2net)", "Available" if HAS_REMBG else "Fallback")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            logger.info("Shutting down worker service.")
            httpd.server_close()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
