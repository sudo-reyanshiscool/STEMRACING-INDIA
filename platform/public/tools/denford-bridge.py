#!/usr/bin/env python3
"""Read one explicitly selected Denford gate and relay measurements to STEM Racing.
Standard library only. No gate admin password, writes, launch controls or scanning.
Run: python3 denford-bridge.py --config /path/to/denford-connection.json
"""
import argparse
import ipaddress
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused; use the exact gate or project address')


def configuration(path):
    config = json.loads(Path(path).read_text())
    if config.get('connectionMethod', 'wifi') not in ('wifi', 'ethernet'):
        raise ValueError('Choose Wi-Fi or Ethernet in Race control')
    gate = urllib.parse.urlsplit(config['gateUrl'])
    project = urllib.parse.urlsplit(config['projectUrl'])
    if gate.scheme != 'http' or gate.username or gate.password or gate.query or gate.fragment or gate.path not in ('', '/'):
        raise ValueError('Gate address must be a plain http:// private IP address')
    address = ipaddress.ip_address(gate.hostname or '')
    if not address.is_private or address.is_unspecified or address.is_multicast:
        raise ValueError('Use the exact private IP address of your track')
    if project.scheme != 'https' or not (project.hostname or '').endswith('.supabase.co') or project.username or project.password or project.path not in ('', '/') or project.query or project.fragment:
        raise ValueError('Project address must be your https://PROJECT.supabase.co URL')
    if not isinstance(config['token'], str) or len(config['token']) != 72 or not isinstance(config['anonKey'], str):
        raise ValueError('Invalid pairing file; download a fresh file from Race control')
    return config


def read_gate(opener, gate_url):
    with opener.open(gate_url.rstrip('/') + '/times.json', timeout=2) as response:
        raw = response.read(8193)
    if len(raw) > 8192:
        raise ValueError('Track response is too large')
    data = json.loads(raw)
    if not isinstance(data, dict) or 'raceid' not in data:
        raise ValueError('This address did not return Denford track data')
    return data


def publish(opener, config, payload):
    request = urllib.request.Request(config['projectUrl'].rstrip('/') + '/rest/v1/rpc/ingest_denford',
        data=json.dumps({'p_token': config['token'], 'p_payload': payload}).encode(),
        headers={'apikey': config['anonKey'], 'Authorization': 'Bearer ' + config['anonKey'],
                 'Content-Type': 'application/json', 'Content-Profile': 'stem_racing'}, method='POST')
    with opener.open(request, timeout=10) as response:
        if json.loads(response.read(1024)) is not True:
            raise ValueError('The platform did not accept the track data')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    try:
        config = configuration(args.config)
    except (OSError, ValueError, KeyError, TypeError):
        parser.error('Could not load a valid pairing file. Download it from Race control.')
    # Never send local gate traffic to an ambient system proxy. HTTPS uploads use normal system trust.
    gate_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    cloud_opener = urllib.request.build_opener(NoRedirect())
    print('Read-only Denford connection:', config.get('connectionMethod', 'wifi'), config['gateUrl'], flush=True)
    print('Keep this running on the track laptop. Ctrl+C disconnects. Pairing expires after 8 hours.', flush=True)
    previous = None
    sent_at = 0
    last_state = ''
    try:
        while True:
            try:
                payload = read_gate(gate_opener, config['gateUrl'])
                if payload != previous or time.monotonic() - sent_at >= 5:
                    publish(cloud_opener, config, payload)
                    previous = payload
                    sent_at = time.monotonic()
                if last_state != 'connected':
                    print('Connected. Live measurements are reaching Race control.', flush=True)
                    last_state = 'connected'
                time.sleep(.25)
            except urllib.error.HTTPError as exc:
                if exc.code in (401, 403):
                    print('Pairing expired, replaced, or event locked. Download a fresh pairing file.', flush=True)
                    return
                if last_state != 'offline':
                    print('Connection interrupted. Retrying; official results are unchanged.', flush=True)
                    last_state = 'offline'
                time.sleep(2)
            except (OSError, ValueError, urllib.error.URLError):
                if last_state != 'offline':
                    print('Waiting for the selected track and internet connection. Retrying.', flush=True)
                    last_state = 'offline'
                time.sleep(2)
    except KeyboardInterrupt:
        print('\nDisconnected.', flush=True)


if __name__ == '__main__':
    main()
