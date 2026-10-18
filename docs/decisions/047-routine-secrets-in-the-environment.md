# 047 — Routine secrets travel with the environment, sealed with a passphrase

Date: 2026-10-18. Status: owner request; implemented for 0.2.25.
Revises [ADR 043](043-routines-in-the-environment.md) D5 and
[ADR 026](026-github-account-environment.md) D3 for secrets only. Keeps
[ADR 016](016-routines.md) D5 (secrets are sealed with the OS-held key on each
device) as it is.

## Context

The owner asked that the secrets routines use be carried by **環境を保存**,
"without undoing their encryption". On each device a secret is sealed with a
key the OS keeps (Keychain, DPAPI, secret service). That key never leaves the
device, so a value sealed with it cannot be opened anywhere else: copying
`secrets.json` as it is would carry nothing usable. Some key both devices know
has to seal the values while they travel.

Keys considered:

- **A passphrase the person chooses.** Works with one device at a time, which
  is how saving and restoring already work (ADR 026 D4).
- **A key pair per device**, the new device publishing its public key and an
  old device sealing to it. No passphrase, but restoring would need the old
  device to save again after the new one asked, and a lost old device loses
  the secrets.
- **The GitHub sign-in.** The token is not a key, changes, and anyone holding
  it already reads the private repository; it would add no protection.

## Decisions

1. **A passphrase seals the saved secrets.** **環境を保存** shows a
   passphrase field when this device keeps secrets. With a passphrase of 12
   characters or more, the host opens each value with the device's key, seals
   all of them together with a key derived from the passphrase (scrypt,
   N = 2^17, r = 8, p = 1; AES-256-GCM) and writes `routine-keys.json` beside
   `environment.json`. The values exist in plain form only in the host
   process's memory: never on disk, on GitHub, or in the window, and the
   passphrase is not stored anywhere.
2. **The names stay readable.** The file lists the names in the clear, so the
   restore sheet can offer them before the passphrase is entered. The names are
   bound to the sealed data, so a changed list fails to open.
3. **Saving without a passphrase leaves the saved secrets alone.** With one,
   the saved set is replaced by this device's, as routines are (ADR 043 D2),
   and the section says how many saved names that drops.
4. **Restoring adds secrets only.** **環境を復元** lists the saved names; the
   chosen ones this device lacks are opened with the passphrase and sealed
   with this device's key. A name already here keeps its value. The passphrase
   is checked first, so a wrong one stops the restore before anything is
   cloned. A device that cannot keep secrets (ADR 016 D5) offers none.
5. **The file's cost is bounded.** A file asking for a larger scrypt cost than
   N = 2^20, r = 32, p = 4 is refused as damaged, so a changed file cannot make
   irori use unbounded memory.

## Consequences

- Moving to a new device brings routine secrets along with one passphrase,
  without entering each token again.
- The secrets are protected twice on GitHub: the repository is private, and
  the file is useless without the passphrase. A forgotten passphrase loses
  only the saved copy; the device that saved it still holds the values and
  can save again with a new one.
- Reviews still stay on each device: a restored routine runs only after its
  review there.
