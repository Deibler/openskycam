"""Small JPEGs of Workshop images for the website and agents, so they need no paid image service."""
import io


def thumbnail(data: bytes, size: int, crop: tuple[int, int, int, int] | None) -> bytes:
    """`crop` (left, top, width, height in pixels) enlarged or shrunk to fit size x size; without one, the
    whole image only shrunk. Pillow is imported here, not at startup, so footage never depends on it."""
    from PIL import Image

    image = Image.open(io.BytesIO(data))
    width, height = image.size
    left, top, w, h = crop or (0, 0, width, height)
    scale = size / max(w, h) if crop else min(1, size / max(w, h))
    # JPEG DCT scaling: a 4K frame thumbnail decodes at 1/4 size; a small object crop at full size.
    image.draft('RGB', (round(width * scale), round(height * scale)))
    k = image.size[0] / width
    region = image.crop((round(left * k), round(top * k), round((left + w) * k), round((top + h) * k)))
    region = region.convert('RGB').resize((max(1, round(w * scale)), max(1, round(h * scale))), getattr(Image, 'Resampling', Image).LANCZOS)  # Resampling is Pillow 9.1+; Ubuntu 22.04 has 9.0
    out = io.BytesIO()
    region.save(out, 'JPEG', quality=75)
    return out.getvalue()
