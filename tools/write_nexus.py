import os

path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "gin_rummy", "nexus.py")

print(f"Writing to {path}")
print("Done")