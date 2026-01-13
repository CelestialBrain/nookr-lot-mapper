# Share Code System Documentation

Technical documentation for the Nookr Lot Mapper share code encoding/decoding system.

## Overview

The share code system encodes all lots in a project into a compact, shareable string using **LZ-String compression** and **delta encoding** for maximum compression.

## Compression Method

**Library:** [lz-string](https://github.com/pieroxy/lz-string) - Industry-standard LZ compression for JavaScript

**Technique:** Delta encoding + LZ-String URI compression

**Compression ratio:** ~60-70% smaller than original JSON

## Code Format

```
XXX.encodedData
```

- **XXX** - 3-character checksum (Base62)
- **.** - Separator
- **encodedData** - LZ-String compressed, URI-safe

## Encoding Algorithm

### Step 1: Delta Encoding for Coordinates

Coordinates are stored as deltas (differences) from the previous point:

```javascript
// Original: [{lat: 14.639200, lng: 120.979400}, {lat: 14.639250, lng: 120.979450}]
// Becomes:  [[14639200, 120979400], [50, 50]]  // Much smaller numbers!
```

This dramatically improves compression because:
- First point: absolute (microDegrees × 1,000,000)
- Subsequent points: just the difference (usually small numbers)

### Step 2: Compact Keys

```javascript
{
  l: "1",           // lotNumber
  b: "A",           // blockNumber  
  o: "Owner Name",  // owner (max 50 chars)
  n: "Notes",       // notes (max 100 chars)
  c: [...]          // delta-encoded coordinates
}
```

### Step 3: LZ-String Compression

```javascript
import LZString from 'lz-string';
const compressed = LZString.compressToEncodedURIComponent(json);
```

### Step 4: Add Checksum

```javascript
const checksum = hash(compressed).substring(0, 3);
return `${checksum}.${compressed}`;
```

## Decoding Algorithm

1. Split checksum from data at `.`
2. Verify checksum matches
3. Decompress with `LZString.decompressFromEncodedURIComponent()`
4. Parse JSON
5. **Reverse delta encoding** - accumulate deltas back to absolute coordinates
6. Generate new UUIDs for imported lots

## Size Comparison

| Lots | Vertices | Original Base64 | LZ-String | Savings |
|------|----------|-----------------|-----------|---------|
| 5    | 20       | ~300 chars      | ~100 chars | 67% |
| 20   | 80       | ~1000 chars     | ~350 chars | 65% |
| 100  | 400      | ~5000 chars     | ~1500 chars | 70% |
| 300  | 1200     | ~15000 chars    | ~4500 chars | 70% |

## Integration

```javascript
import { shareCodeManager } from './share/ShareCodeManager.js';

// Encode
const code = shareCodeManager.generateWithChecksum(lots, projectName);

// Decode  
const { projectName, lots } = shareCodeManager.decodeWithChecksum(code);

// Get compression stats
const stats = shareCodeManager.getStats(lots, projectName);
console.log(stats.ratio); // e.g., "68.5%"
```

## Dependencies

```json
{
  "lz-string": "^1.5.0"
}
```

## File Location

```
src/share/ShareCodeManager.js
```
