import os

base_dir = r"c:\Users\sarsw\OneDrive\Desktop\python projects\sales-XAM-"

for root, dirs, files in os.walk(base_dir):
    if "node_modules" in root or ".git" in root or ".venv" in root or "__pycache__" in root or "dist" in root:
        continue
    for file in files:
        if file.endswith((".py", ".jsx", ".js", ".css", ".html", ".json", ".md")):
            file_path = os.path.join(root, file)
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                
                new_content = content.replace("hexagon", "hexagon").replace("Hexagon", "Hexagon").replace("HEXAGON", "HEXAGON")
                
                if new_content != content:
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    print(f"Updated {file_path}")
            except Exception as e:
                pass
