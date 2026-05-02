import fetch from 'node-fetch';

async function test() {
    const query = `
      [out:json][timeout:25];
      way["boundary"="administrative"]["admin_level"="4"](8.0622, 68.1623, 37.1000, 97.3956);
      out geom limit 10;
    `;
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    const data = await res.json();
    console.log("Elements:", data.elements.length, data.elements[0] ? Object.keys(data.elements[0]) : "none");
}
test();
