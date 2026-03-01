import subprocess
import sys
import os
import webbrowser
import threading
import time

def open_browser():
    time.sleep(2)  # wait for Flask to start
    webbrowser.open("http://127.0.0.1:5000")

if __name__ == "__main__":
    threading.Thread(target=open_browser).start()
    from app import app
    app.run(host="127.0.0.1", port=5000)