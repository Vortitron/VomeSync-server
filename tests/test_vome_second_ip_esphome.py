"""`vome-second-ip esphome`: fin1's half of ESPHome dial-in.

The map files are written by the unprivileged portal and read here as root,
so what matters is what the script refuses. Run against a fake iptables
that records its arguments.
"""
import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'docker' / 'host' / 'vome-second-ip'


def _run(tmp_path, maps, *args, listing=''):
	bin_dir = tmp_path / 'bin'
	bin_dir.mkdir(exist_ok=True)
	fake = bin_dir / 'iptables'
	fake.write_text(
		'#!/bin/sh\necho "iptables $*" >> "$IPT_LOG"\n'
		'case "$*" in *"-L "*) cat "$IPT_LIST";; esac\nexit 0\n')
	fake.chmod(0o755)
	(tmp_path / 'list').write_text(listing)
	for lane, text in maps.items():
		(tmp_path / lane).mkdir(exist_ok=True)
		(tmp_path / lane / 'dial-in.map').write_text(text)
	log = tmp_path / 'log'
	log.write_text('')
	env = {**os.environ, 'PATH': f'{bin_dir}:{os.environ["PATH"]}', 'IPT_LOG': str(log),
	       'IPT_LIST': str(tmp_path / 'list'),
	       'VOME_ESPHOME_MAPS': f'{tmp_path}/*/dial-in.map'}
	subprocess.run(['sh', str(SCRIPT), *args], env=env, check=True)
	return log.read_text()


def test_only_tunnel_targets_in_range_once_each_are_forwarded(tmp_path):
	rules = _run(tmp_path, {
		'live': '40200 10.99.0.2\n40202 8.8.8.8\n40203 10.99.0.999\n39999 10.99.0.2\n'
		        '40204 10.99.0.2 extra\nnonsense\n40205 10.99.0.3\n',
		'staging': '40205 10.99.0.2\n40600 10.99.0.2\n',
	}, 'esphome')
	assert '--dport 40200 -j DNAT --to-destination 10.99.0.2:40200' in rules
	assert '--dport 40600 -j DNAT --to-destination 10.99.0.2:40600' in rules
	for refused in ('40202', '40203', '39999', '40204', '40205'):
		assert f'--dport {refused} ' not in rules, refused
	# Replies come back through fin1, and new connections are rate-limited
	# above the accept, both scoped to the range on .207 only.
	assert 'POSTROUTING 1 -p tcp -m conntrack --ctorigdst 95.216.77.207/32 --ctorigdstport 40200:40999' in rules
	limit = rules.index('--hashlimit-above')
	accept_new = rules.index('--ctstate NEW -m comment --comment vome-esphome -j ACCEPT')
	assert limit > accept_new  # inserted at 1 last, so it ends up first


def test_esphome_rebuild_leaves_the_router_and_guard_alone(tmp_path):
	listing = (
		'1    VOME-207-ESPHOME  tcp  --  0.0.0.0/0  95.216.77.207  /* vome-esphome */\n'
		'2    DNAT  tcp  --  0.0.0.0/0  95.216.77.207  tcp dpt:443 /* vome-e2e */\n'
	)
	rules = _run(tmp_path, {}, 'esphome', listing=listing)
	assert '-D PREROUTING 1' in rules
	assert '-D PREROUTING 2' not in rules
	assert 'VOME-207 ' not in rules.replace('VOME-207-ESPHOME', '')
