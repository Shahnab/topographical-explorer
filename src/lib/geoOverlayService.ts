export async function fetchRivers(bbox: [number, number, number, number]) {
    let [minLat, maxLat, minLon, maxLon] = bbox;
    
    minLon = Math.max(-180, Math.min(180, minLon));
    maxLon = Math.max(-180, Math.min(180, maxLon));
    if (minLon > maxLon) return [];

    const query = `
      [out:json][timeout:25];
      way["waterway"="river"](${minLat},${minLon},${maxLat},${maxLon});
      out geom limit 250;
    `;
    
    try {
        const res = await fetch(`https://overpass-api.de/api/interpreter`, {
            method: 'POST',
            body: query
        });
        if (!res.ok) throw new Error("Overpass API failed");
        const data = await res.json();
        return data.elements || [];
    } catch (e) {
        console.warn("Failed to fetch rivers", e);
        return [];
    }
}

export async function fetchStateBoundaries(bbox: [number, number, number, number], osmRelationId?: number) {
    let [minLat, maxLat, minLon, maxLon] = bbox;
    
    minLon = Math.max(-180, Math.min(180, minLon));
    maxLon = Math.max(-180, Math.min(180, maxLon));
    if (minLon > maxLon) return [];

    // When we have the country's OSM relation ID, use the Overpass area filter
    // so only sub-regions of THAT country are returned, not neighbouring countries'
    // admin boundaries that happen to fall inside the bounding box.
    let query: string;
    if (osmRelationId) {
        const areaId = osmRelationId + 3600000000;
        query = `
          [out:json][timeout:30];
          area(${areaId})->.country;
          (
            way["boundary"="administrative"]["admin_level"="4"](area.country);
            relation["boundary"="administrative"]["admin_level"="4"](area.country);
          );
          out geom;
        `;
    } else {
        query = `
          [out:json][timeout:25];
          (
            way["boundary"="administrative"]["admin_level"="4"](${minLat},${minLon},${maxLat},${maxLon});
            relation["boundary"="administrative"]["admin_level"="4"](${minLat},${minLon},${maxLat},${maxLon});
          );
          out geom;
        `;
    }
    
    try {
        const res = await fetch(`https://overpass-api.de/api/interpreter`, {
            method: 'POST',
            body: query
        });
        if (!res.ok) throw new Error("Overpass API failed");
        const data = await res.json();
        return data.elements || [];
    } catch (e) {
        console.warn("Failed to fetch state boundaries", e);
        return [];
    }
}

export async function fetchWeather(lat: number, lon: number) {
    try {
        const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,cloud_cover,weather_code`);
        if (!res.ok) throw new Error("Open-Meteo API failed");
        const data = await res.json();
        return data.current; 
        // returns { temperature_2m, precipitation, cloud_cover, weather_code }
    } catch (e) {
        console.warn("Failed to fetch weather", e);
        return null;
    }
}
