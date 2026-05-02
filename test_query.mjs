import fetch from 'node-fetch';

async function test() {
    console.log("fetching...");
    // India rough bbox
    const query = `
      [out:json][timeout:25];
      (
        relation["boundary"="administrative"]["admin_level"="4"](8.0622, 68.1623, 37.1000, 97.3956);
      );
      out geom limit 2;
    `;
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    const data = await res.json();
    console.log("Elements:", data.elements.length);
    if(data.elements.length > 0) {
        console.log("keys:", Object.keys(data.elements[0]));
        console.log("members preview:", data.elements[0].members ? data.elements[0].members.slice(0, 2) : "no members");
    }
}
test();
