import os
from PIL import ImageFont

fonts_to_test = [
    "C:\\Windows\\Fonts\\segoeui.ttf",
    "C:\\Windows\\Fonts\\segoeuib.ttf",
    "C:\\Windows\\Fonts\\consolas.ttf",
    "C:\\Windows\\Fonts\\arial.ttf"
]

print("Testing fonts:")
for f in fonts_to_test:
    exists = os.path.exists(f)
    print(f"{f}: {'Exists' if exists else 'Not Found'}")
    if exists:
        try:
            font = ImageFont.truetype(f, 12)
            print("  Successfully loaded!")
        except Exception as e:
            print(f"  Error loading: {e}")
