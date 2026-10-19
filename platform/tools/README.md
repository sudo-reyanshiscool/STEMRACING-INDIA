# Denford race timing

This uses the same StartGate v1.9 `/times.json` feed as the existing Pit Reaction
Time project. It reads integer milliseconds from `playerNTriggerTime`,
`playerNRaceTime` and `playerNCombinedTime`. 99997/99998/99999 are false-start,
DNS and DNF markers. Reaction-only mode has no finish measurements: those are
never simulated or substituted into official results.

1. On Race control, choose **Track Wi-Fi** or **Ethernet** and enter the track's
   exact private IP address. Use the address that works on your selected connection. Wi-Fi commonly uses
   `http://10.0.0.1`. For Ethernet, use the wired address actually configured on the
   gate (`192.168.50.2` is the direct-cable example in the existing project).
   The selector records your choice; it does not configure network interfaces. No
   scanning or fallback to `raspberrypi.local` is performed.
2. Download the Python bridge from Race control and download a pairing file
   using **Pair track laptop**. Only the organiser, Chair and race officials can
   pair. Re-pairing immediately revokes the previous connection; pairings expire
   after eight hours. The file contains a limited feed-upload credential: keep it
   private and do not commit it.
3. Run `python3 denford-bridge.py --config /path/to/denford-connection.json` on
   the laptop connected to the track. Python's standard library is sufficient.
   The laptop needs both track access and internet access to upload to Supabase.
   Joining the track’s own Wi-Fi may provide no internet; use a separate internet
   connection, such as phone tethering, if that is your setup. The bridge does
   not change any Wi-Fi or track settings.
4. Select a queued heat and verify both lane assignments. Wait for the track to
   show Connected, then **Capture next track run**. The existing race ID becomes
   the baseline; old results are never silently assigned to a new heat.
5. The next complete race ID fills the lane measurements. Review them and
   **Save race result**. Reaction-only readings require real finish times to be
   entered manually. Refresh/reconnect and partially written gate JSON cannot
   manufacture a result.

The bridge only GETs `/times.json`. It does not send names, passwords, GPIO,
start/reset commands or admin requests to the gate. All outgoing cloud traffic
uses HTTPS. The device credential can only stage track data for its one event;
only a signed-in race official can save that data as an official race record.
This avoids browser mixed-content and private-network restrictions on the live
HTTPS platform. Hardware operation must be bench-tested against the actual
track before use; protocol and simulated-feed tests do not prove physical timing.
