#!/usr/bin/env python3
import io
import unittest
from PIL import Image, ImageDraw
import photo_worker

class TestPhotoWorker(unittest.TestCase):
    def setUp(self):
        # Create a sample test image (300x200) with a blue background and a person-like shape
        self.img = Image.new("RGB", (300, 200), color=(30, 80, 180))
        draw = ImageDraw.Draw(self.img)
        # Head
        draw.ellipse((120, 30, 180, 90), fill=(240, 200, 160))
        # Body / uniform
        draw.rectangle((100, 90, 200, 180), fill=(230, 0, 126))
        buf = io.BytesIO()
        self.img.save(buf, format="JPEG")
        self.image_bytes = buf.getvalue()

    def test_remove_background_bytes(self):
        cutout_bytes, w, h = photo_worker.remove_background_bytes(self.image_bytes)
        self.assertEqual(w, 300)
        self.assertEqual(h, 200)
        self.assertTrue(len(cutout_bytes) > 0)

        # Inspect resulting image
        out_img = Image.open(io.BytesIO(cutout_bytes))
        self.assertEqual(out_img.mode, "RGBA")
        self.assertEqual(out_img.size, (300, 200))
        # Check that top-left pixel (was background) has been made transparent
        alpha = out_img.getpixel((10, 10))[3]
        self.assertEqual(alpha, 0, "Background should be transparent")

if __name__ == "__main__":
    unittest.main()
