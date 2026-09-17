import importlib.util
import os

_here = os.path.dirname(os.path.abspath(__file__))
_src  = os.path.join(_here, 'usht-license-server', 'license_server.py')

_spec   = importlib.util.spec_from_file_location('license_server', _src)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

app = _module.app