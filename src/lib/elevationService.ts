import { geoPath, geoTransform } from "d3-geo";

// Tile coordinate math
export function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}
export function lat2tile(lat: number, zoom: number): number {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

function decodeElevation(r: number, g: number, b: number): number {
  return (r * 256 + g + b / 256) - 32768;
}

export type ElevationData = {
    gridWidth: number;
    gridHeight: number;
    aspectRatio: number;
    mask: Uint8Array;
    elevation: Float32Array;
    minElev: number;
    maxElev: number;
    // Projection parameters for overlay alignment
    z: number;
    minPxX: number;
    actualMinPxY: number;
    pxWidth: number;
    pxHeight: number;
    geojson: any;
};

export async function fetchElevationData(
  bbox: [number, number, number, number], 
  geojson: any
): Promise<ElevationData> {
  const [minLat, maxLat, minLon, maxLon] = bbox;
  
  // 1. Determine optimal zoom level
  const deltaLon = maxLon - minLon;
  let z = Math.floor(Math.log2((2 * 360) / deltaLon)) + 1; // Base zoom a bit higher
  z = Math.max(0, Math.min(z, 14)); // Keep it reasonable to prevent crashes.

  let minX, maxX, minY, maxY, cols, rows;
  while (true) {
    minX = lon2tile(minLon, z);
    maxX = lon2tile(maxLon, z);
    minY = lat2tile(maxLat, z); 
    maxY = lat2tile(minLat, z); 

    cols = maxX - minX + 1;
    rows = maxY - minY + 1;

    // limit the download pool strictly for massive maps
    if (cols * rows > 150 && z > 0) { // allow more tiles for higher detail
      z--;
    } else {
      break;
    }
  }

  const tileWidth = 256;
  const tileHeight = 256;

  // 3. Setup offscreen canvas to stitch tiles
  const canvas = document.createElement('canvas');
  canvas.width = cols * tileWidth;
  canvas.height = rows * tileHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2D context");

  const tilePromises = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tilePromises.push(new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, (x - minX) * tileWidth, (y - minY) * tileHeight);
          resolve();
        };
        img.onerror = () => resolve(); 
        
        const numTiles = Math.pow(2, z);
        let wrappedX = x;
        if (numTiles > 0) {
            wrappedX = ((x % numTiles) + numTiles) % numTiles;
        }
        
        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${wrappedX}/${y}.png`;
      }));
    }
  }

  await Promise.all(tilePromises);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const getElevationPixel = (pixelX: number, pixelY: number) => {
    const localX = Math.floor(pixelX - minX * 256);
    const localY = Math.floor(pixelY - minY * 256);
    if (localX < 0 || localX >= canvas.width || localY < 0 || localY >= canvas.height) return 0;
    const i = (localY * canvas.width + localX) * 4;
    return decodeElevation(imgData.data[i], imgData.data[i+1], imgData.data[i+2]);
  };

  const getPixelCoord = (lon: number, lat: number) => {
    const pixelX = ((lon + 180) / 360) * Math.pow(2, z) * 256;
    const sinLat = Math.sin((lat * Math.PI) / 180);
    const MathLog = Math.log((1 + sinLat) / (1 - sinLat));
    // prevent singularity at pole
    const safeLog = isNaN(MathLog) ? 0 : MathLog; 
    const pixelY = (0.5 - safeLog / (4 * Math.PI)) * Math.pow(2, z) * 256;
    return [pixelX, pixelY];
  };

  const [minPxX, minPxY] = getPixelCoord(minLon, maxLat);
  const [maxPxX, maxPxY] = getPixelCoord(maxLon, minLat);
  const pxWidth = maxPxX - minPxX;
  const pxHeight = Math.abs(maxPxY - minPxY);
  const aspectRatio = pxWidth / pxHeight;

  let gridWidth = 512;
  let gridHeight = 512;
  if (aspectRatio > 1) {
      gridHeight = Math.max(64, Math.floor(gridWidth / aspectRatio));
  } else {
      gridWidth = Math.max(64, Math.floor(gridHeight * aspectRatio));
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = gridWidth;
  maskCanvas.height = gridHeight;
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!;
  
  const geojsonObj = geojson.type === "FeatureCollection" ? geojson : {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: geojson, properties: {} }]
  };

  const project = geoTransform({
    point: function(lon: number, lat: number) {
      const [px, py] = getPixelCoord(lon, lat);
      const x = ((px - minPxX) / pxWidth) * gridWidth;
      const yMinPxY = Math.min(minPxY, maxPxY);
      const y = ((py - yMinPxY) / pxHeight) * gridHeight;
      this.stream.point(x, y);
    }
  });

  const pathGenerator = geoPath().projection(project).context(maskCtx);
  
  maskCtx.fillStyle = 'black';
  maskCtx.fillRect(0, 0, gridWidth, gridHeight);
  maskCtx.fillStyle = '#ffffff';
  maskCtx.beginPath();
  pathGenerator(geojsonObj as any);
  maskCtx.fill();

  const maskImgData = maskCtx.getImageData(0, 0, gridWidth, gridHeight).data;
  
  const mask = new Uint8Array(gridWidth * gridHeight);
  const elevation = new Float32Array(gridWidth * gridHeight);
  
  let minElev = Infinity;
  let maxElev = -Infinity;

  const actualMinPxY = Math.min(minPxY, maxPxY);

  for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
          const idx = y * gridWidth + x;
          const isInside = maskImgData[idx * 4] > 128; 
          
          mask[idx] = isInside ? 255 : 0;
          
          const px = minPxX + (x / gridWidth) * pxWidth;
          const py = actualMinPxY + (y / gridHeight) * pxHeight;
          const elev = getElevationPixel(px, py);
          const cleanElev = Math.max(0, elev); 

          elevation[idx] = cleanElev;

          if (isInside) {
              minElev = Math.min(minElev, cleanElev);
              maxElev = Math.max(maxElev, cleanElev);
          }
      }
  }

  if (minElev === maxElev || minElev === Infinity) {
    minElev = 0;
    maxElev = maxElev || 100;
  }

  console.log(`Grid generated: ${gridWidth}x${gridHeight}. Elev: ${minElev}-${maxElev}`);

  return { gridWidth, gridHeight, aspectRatio, mask, elevation, minElev, maxElev, z, minPxX, actualMinPxY, pxWidth, pxHeight, geojson: geojsonObj };
}

