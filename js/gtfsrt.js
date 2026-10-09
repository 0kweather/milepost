// Minimal GTFS-realtime decoder. Reads just the parts of the protobuf schema a
// train map needs (vehicle positions + trip updates), so no protobuf library
// or build step is required. Field numbers follow gtfs-realtime.proto.

class Reader {
  constructor(buf, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  varint() {
    // Values above 2^53 (negative int64s) lose precision, which is fine here.
    let result = 0, mul = 1, b;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return result;
  }
  // Iterates fields, calling fn(fieldNumber, wireType, reader). fn must consume
  // the value via one of the read helpers or the reader skips it.
  each(fn) {
    while (this.pos < this.end) {
      const key = this.varint();
      const field = Math.floor(key / 8), wire = key & 7;
      const before = this.pos;
      fn(field, wire, this);
      if (this.pos === before) this.skip(wire);
    }
  }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      const len = this.varint(); // read before touching pos: `pos += varint()` would use the stale pos
      this.pos += len;
    }
    else if (wire === 5) this.pos += 4;
    else throw new Error("unsupported wire type " + wire);
  }
  sub() {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos, this.pos + len);
    this.pos += len;
    return r;
  }
  string() {
    const len = this.varint();
    const s = decoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  float() {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  double() {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  int32() {
    // Negative int32s are sign-extended to 10-byte varints; keep the low 32 bits.
    let lo = 0, shift = 0, b;
    do {
      b = this.buf[this.pos++];
      if (shift < 32) lo |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return lo | 0;
  }
}

const decoder = new TextDecoder();

function tripDescriptor(r) {
  const t = {};
  r.each((f, w, r) => {
    if (f === 1) t.tripId = r.string();
    else if (f === 2) t.startTime = r.string();
    else if (f === 3) t.startDate = r.string();
    else if (f === 5) t.routeId = r.string();
    else if (f === 6) t.directionId = r.varint();
  });
  return t;
}

function vehicleDescriptor(r) {
  const v = {};
  r.each((f, w, r) => {
    if (f === 1) v.id = r.string();
    else if (f === 2) v.label = r.string();
  });
  return v;
}

function position(r) {
  const p = {};
  r.each((f, w, r) => {
    if (f === 1) p.lat = r.float();
    else if (f === 2) p.lon = r.float();
    else if (f === 3) p.bearing = r.float();
    else if (f === 5) p.speed = r.float(); // meters/second
  });
  return p;
}

function vehiclePosition(r) {
  const v = {};
  r.each((f, w, r) => {
    if (f === 1) v.trip = tripDescriptor(r.sub());
    else if (f === 2) v.position = position(r.sub());
    else if (f === 4) v.status = r.varint();
    else if (f === 5) v.timestamp = r.varint();
    else if (f === 7) v.stopId = r.string();
    else if (f === 8) v.vehicle = vehicleDescriptor(r.sub());
  });
  return v;
}

function stopTimeEvent(r) {
  const e = {};
  r.each((f, w, r) => {
    if (f === 1) e.delay = r.int32();
    else if (f === 2) e.time = r.varint();
  });
  return e;
}

function stopTimeUpdate(r) {
  const s = {};
  r.each((f, w, r) => {
    if (f === 1) s.seq = r.varint();
    else if (f === 2) s.arrival = stopTimeEvent(r.sub());
    else if (f === 3) s.departure = stopTimeEvent(r.sub());
    else if (f === 4) s.stopId = r.string();
    else if (f === 5) s.skipped = r.varint() === 1;
  });
  return s;
}

function tripUpdate(r) {
  const u = { stops: [] };
  r.each((f, w, r) => {
    if (f === 1) u.trip = tripDescriptor(r.sub());
    else if (f === 2) u.stops.push(stopTimeUpdate(r.sub()));
    else if (f === 3) u.vehicle = vehicleDescriptor(r.sub());
    else if (f === 4) u.timestamp = r.varint();
    else if (f === 5) u.delay = r.int32();
  });
  return u;
}

// Returns { timestamp, vehicles: [...], tripUpdates: [...] }.
export function decodeFeed(arrayBuffer) {
  const r = new Reader(new Uint8Array(arrayBuffer));
  const feed = { timestamp: 0, vehicles: [], tripUpdates: [] };
  r.each((f, w, r) => {
    if (f === 1) {
      r.sub().each((f, w, r) => {
        if (f === 3) feed.timestamp = r.varint();
      });
    } else if (f === 2) {
      let tu = null, vp = null;
      r.sub().each((f, w, r) => {
        if (f === 3) tu = tripUpdate(r.sub());
        else if (f === 4) vp = vehiclePosition(r.sub());
      });
      // Some feeds (Metro-North) pair a trip update with a vehicle record in
      // the same entity, where the vehicle carries the train number.
      if (tu) {
        tu.entityVehicle = vp;
        feed.tripUpdates.push(tu);
      }
      if (vp) feed.vehicles.push(vp);
    }
  });
  return feed;
}
