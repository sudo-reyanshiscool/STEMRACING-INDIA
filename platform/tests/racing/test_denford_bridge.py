"""No hardware or network required: verify the bridge's trust boundaries."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).parents[2] / 'public/tools/denford-bridge.py'
spec = importlib.util.spec_from_file_location('bridge', SCRIPT)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class Reply:
    def __init__(self, body): self.body = body
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, size): return self.body[:size]

class Opener:
    def __init__(self, body): self.body = body; self.calls = []
    def open(self, request, **kwargs): self.calls.append(request); return Reply(self.body)

class BridgeTests(unittest.TestCase):
    def config(self, **overrides):
        data = {'gateUrl':'http://10.0.0.1', 'projectUrl':'https://testproject.supabase.co', 'anonKey':'public-key', 'token':'x'*72, **overrides}
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'config.json'; p.write_text(json.dumps(data))
            return bridge.configuration(p)
    def test_wifi_gate_is_explicit_and_no_scan_occurs(self):
        config=self.config(); op=Opener(b'{"raceid":"12"}')
        self.assertEqual(bridge.read_gate(op, config['gateUrl']), {'raceid':'12'})
        self.assertEqual(op.calls, ['http://10.0.0.1/times.json'])
    def test_rejects_public_ambiguous_or_credential_bearing_gate_addresses(self):
        for url in ['http://raspberrypi.local','http://8.8.8.8','http://user:password@10.0.0.1','http://10.0.0.1/admin.php']:
            with self.assertRaises(ValueError): self.config(gateUrl=url)
    def test_rejects_wrong_cloud_destination(self):
        for url in ['http://testproject.supabase.co','https://testproject.supabase.co.evil.test','https://evil.test']:
            with self.assertRaises(ValueError): self.config(projectUrl=url)
    def test_only_uploads_staging_rpc_and_never_gate_admin_requests(self):
        config=self.config(); op=Opener(b'true'); bridge.publish(op,config,{'raceid':'12'})
        request=op.calls[0]
        self.assertEqual(request.full_url,'https://testproject.supabase.co/rest/v1/rpc/ingest_denford')
        self.assertEqual(request.get_header('Content-profile'),'stem_racing')
        self.assertEqual(json.loads(request.data)['p_payload'],{'raceid':'12'})
    def test_wired_address_and_schema_are_explicit(self):
        config=self.config(connectionMethod='ethernet', gateUrl='http://192.168.50.2', dbSchema='public')
        op=Opener(b'true'); bridge.publish(op,config,{'raceid':'12'})
        self.assertEqual(op.calls[0].get_header('Content-profile'),'public')
        self.assertEqual(config['gateUrl'],'http://192.168.50.2')
    def test_rejects_invalid_application_schema(self):
        for schema in ['bad schema', 'public;drop', '', 3]:
            with self.assertRaises(ValueError): self.config(dbSchema=schema)
    def test_rejects_partial_or_unrelated_gate_json(self):
        for body in [b'{', b'[]', b'{}', b'x'*8193]:
            with self.assertRaises(ValueError): bridge.read_gate(Opener(body),'http://10.0.0.1')

if __name__=='__main__': unittest.main()
