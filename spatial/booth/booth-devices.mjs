/**
 * Linked / preferred camera device list — pin Continuity, USB, virtual cams
 * with custom labels. Persists in localStorage.
 */

const STORAGE_KEY = "aito-mac.booth.linkedDevices.v1";

/**
 * @typedef {{
 *   id: string,
 *   deviceId: string,
 *   label: string,
 *   kind: string,
 *   role: 'desktop'|'dual'|'desk'|'any',
 *   linkedAt: number,
 *   note?: string,
 * }} LinkedDevice
 */

export class DeviceLinkHub {
  constructor() {
    /** @type {LinkedDevice[]} */
    this.linked = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.linked));
    } catch {
      /* quota */
    }
  }

  list() {
    return [...this.linked];
  }

  /**
   * @param {{ deviceId: string, label: string, kind?: string, role?: LinkedDevice['role'], note?: string }} dev
   */
  link(dev) {
    if (!dev?.deviceId) throw new Error("deviceId required");
    const existing = this.linked.findIndex((d) => d.deviceId === dev.deviceId);
    const entry = {
      id: existing >= 0 ? this.linked[existing].id : `lnk-${Date.now()}`,
      deviceId: dev.deviceId,
      label: (dev.label || "Camera").slice(0, 64),
      kind: dev.kind || "other",
      role: dev.role || "any",
      linkedAt: Date.now(),
      note: dev.note || "",
    };
    if (existing >= 0) this.linked[existing] = entry;
    else this.linked.push(entry);
    this._save();
    return entry;
  }

  unlink(idOrDeviceId) {
    this.linked = this.linked.filter(
      (d) => d.id !== idOrDeviceId && d.deviceId !== idOrDeviceId,
    );
    this._save();
  }

  rename(id, label) {
    const d = this.linked.find((x) => x.id === id || x.deviceId === id);
    if (!d) return null;
    d.label = (label || d.label).slice(0, 64);
    this._save();
    return d;
  }

  setRole(id, role) {
    const d = this.linked.find((x) => x.id === id || x.deviceId === id);
    if (!d) return null;
    d.role = role;
    this._save();
    return d;
  }

  /** Merge live enumerateDevices with linked metadata */
  mergeWithLive(liveDevices) {
    const liveMap = new Map(liveDevices.map((d) => [d.deviceId, d]));
    return this.linked.map((lnk) => {
      const live = liveMap.get(lnk.deviceId);
      return {
        ...lnk,
        online: !!live,
        liveLabel: live?.label || lnk.label,
        liveKind: live?.kind || lnk.kind,
      };
    });
  }

  /** Suggest role-based device from linked + live */
  pickForRole(role, liveDevices) {
    const merged = this.mergeWithLive(liveDevices);
    const prefer = merged.find((d) => d.role === role && d.online);
    if (prefer) return liveDevices.find((d) => d.deviceId === prefer.deviceId) || null;
    const any = merged.find((d) => d.online);
    return any ? liveDevices.find((d) => d.deviceId === any.deviceId) || null : null;
  }
}
