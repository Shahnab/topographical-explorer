import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Map as MapIcon, Loader2 } from 'lucide-react';
import { fetchElevationData, ElevationData } from './lib/elevationService';
import { fetchRivers, fetchStateBoundaries } from './lib/geoOverlayService';
import { COUNTRIES } from './lib/countries';
import Map3D from './Map3D';

export default function App() {
  const [query, setQuery] = useState('Switzerland'); // Default to something nice
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [overlaysLoading, setOverlaysLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elevationData, setElevationData] = useState<ElevationData | null>(null);
  const [riversData, setRiversData] = useState<any[]>([]);
  const [statesData, setStatesData] = useState<any[]>([]);
  const [locationName, setLocationName] = useState('');

  const searchLocation = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setLoadingStage('Locating...');
    setOverlaysLoading(false);
    setError(null);
    setElevationData(null); // Clear old map to show loader
    setRiversData([]);
    setStatesData([]);
    try {
      // 1. Fetch from Nominatim
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=jsonv2&polygon_geojson=1&limit=1`, {
        headers: {
          'User-Agent': 'TopographicalExplorer/1.0 (Google AI Studio)'
        }
      });
      const data = await res.json();
      
      if (!data || data.length === 0) {
        throw new Error("Location not found");
      }
      
      const place = data[0];
      
      let locName = place.display_name.split(',')[0];
      if (searchQuery.toLowerCase() === 'china') locName = 'China';
      setLocationName(locName);
      
      let geojson = place.geojson;
      // Nominatim sometimes returns polygons or LineStrings. We need a Polygon/MultiPolygon.
      if (!geojson || (geojson.type !== 'Polygon' && geojson.type !== 'MultiPolygon')) {
         // Create a simple bounding box polygon if missing
         const [minLat, maxLat, minLon, maxLon] = place.boundingbox.map(Number);
         geojson = {
            type: "Polygon",
            coordinates: [[
               [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]
            ]]
         };
      }

      if (searchQuery.toLowerCase() === 'china') {
          try {
              const res2 = await fetch(`https://nominatim.openstreetmap.org/search?q=Taiwan&format=jsonv2&polygon_geojson=1&limit=1`, {
                  headers: { 'User-Agent': 'TopographicalExplorer/1.0 (Google AI Studio)' }
              });
              const data2 = await res2.json();
              if (data2 && data2.length > 0) {
                  const place2 = data2[0];
                  const geojson2 = place2.geojson;
                  if (geojson2 && (geojson2.type === 'Polygon' || geojson2.type === 'MultiPolygon')) {
                      let newCoordinates = [];
                      if (geojson.type === 'Polygon') newCoordinates.push(geojson.coordinates);
                      else if (geojson.type === 'MultiPolygon') newCoordinates.push(...geojson.coordinates);

                      if (geojson2.type === 'Polygon') newCoordinates.push(geojson2.coordinates);
                      else if (geojson2.type === 'MultiPolygon') newCoordinates.push(...geojson2.coordinates);
                      
                      geojson = {
                          type: 'MultiPolygon',
                          coordinates: newCoordinates
                      };
                  }
              }
          } catch(e) {
              console.error("Failed to fetch Taiwan", e);
          }
      }

      // Unwrap antimeridian crossings
      const referenceLon = Number(place.lon) || 0;
      let minLon = Infinity, maxLon = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;

      const unwrapCoords = (coords: any[]) => {
         coords.forEach(coord => {
             if (Array.isArray(coord[0])) {
                 unwrapCoords(coord);
             } else if (typeof coord[0] === 'number') {
                 let diff = coord[0] - referenceLon;
                 while (diff > 180) diff -= 360;
                 while (diff < -180) diff += 360;
                 coord[0] = referenceLon + diff;

                 minLon = Math.min(minLon, coord[0]);
                 maxLon = Math.max(maxLon, coord[0]);
                 minLat = Math.min(minLat, coord[1]);
                 maxLat = Math.max(maxLat, coord[1]);
             }
         });
      };
      
      if (geojson.type === 'FeatureCollection') {
          geojson.features.forEach((f: any) => unwrapCoords(f.geometry.coordinates));
      } else {
          unwrapCoords(geojson.coordinates);
      }

      const bboxArr = [minLat, maxLat, minLon, maxLon];
      // Use the OSM relation ID to scope state boundaries to this country only
      const osmRelationId = place.osm_type === 'relation' ? Number(place.osm_id) : undefined;

      // 2. Kick off all fetches in parallel immediately
      setLoadingStage('Downloading elevation tiles...');
      const elevPromise = fetchElevationData(bboxArr as [number, number, number, number], geojson);
      const riversPromise = fetchRivers(bboxArr as [number, number, number, number]).catch(() => [] as any[]);
      const statesPromise = fetchStateBoundaries(bboxArr as [number, number, number, number], osmRelationId).catch(() => [] as any[]);

      // 3. Show terrain as soon as elevation is ready — don't wait for overlays
      const elevData = await elevPromise;
      setElevationData(elevData);
      setLoading(false); // unblock the UI and dropdown immediately
      setOverlaysLoading(true);

      // 4. Overlays were already fetching in parallel — process when they arrive
      const [rivers, states] = await Promise.all([riversPromise, statesPromise]);

      const unwrapRiverGeo = (g: any) => {
          let diff = g.lon - referenceLon;
          while (diff > 180) diff -= 360;
          while (diff < -180) diff += 360;
          g.lon = referenceLon + diff;
      };
      if (rivers.length > 0) {
          rivers.forEach((r: any) => { if (r.geometry) r.geometry.forEach(unwrapRiverGeo); });
      }

      const unwrapStateGeo = (g: any) => {
          let diff = g.lon - referenceLon;
          while (diff > 180) diff -= 360;
          while (diff < -180) diff += 360;
          g.lon = referenceLon + diff;
      };
      if (states.length > 0) {
          states.forEach((s: any) => {
             if (s.geometry) s.geometry.forEach(unwrapStateGeo);
             if (s.members) s.members.forEach((m: any) => { if (m.geometry) m.geometry.forEach(unwrapStateGeo); });
          });
      }

      setRiversData(rivers);
      setStatesData(states);
      setOverlaysLoading(false);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load location data");
      setElevationData(null);
    } finally {
      setLoading(false);
      setOverlaysLoading(false);
    }
  };

  useEffect(() => {
    searchLocation(query);
  }, []);

  return (
    <div className="w-full h-screen flex flex-col font-sans bg-[#f5f5f5] text-gray-900 overflow-hidden">
      {/* Header UI */}
      <header className="absolute top-0 left-0 right-0 z-10 p-6 pointer-events-none flex justify-between items-start">
         <div className="flex flex-col gap-1.5">
            <h1 className="text-[2rem] font-bold tracking-[0.18em] text-gray-900/90 uppercase pointer-events-auto" style={{ letterSpacing: '0.2em' }}>
               Topographical Explorer
            </h1>
            <p className="text-[0.68rem] tracking-[0.22em] uppercase text-gray-400 font-normal pointer-events-auto" style={{ letterSpacing: '0.25em' }}>
               3D Elevation · Global Coverage · Mean Grid Height
            </p>
         </div>
         
         {/* Search Box */}
         <div className="pointer-events-auto bg-white rounded-xl shadow-lg border border-black/5 flex items-center p-2 w-80 relative">
            <select 
              value={query}
              onChange={(e) => {
                 setQuery(e.target.value);
                 searchLocation(e.target.value);
              }}
              disabled={loading}
              className="flex-1 outline-none px-3 text-sm bg-transparent appearance-none cursor-pointer disabled:opacity-50 h-full py-2 z-10"
            >
              {COUNTRIES.map(country => (
                <option key={country} value={country}>{country}</option>
              ))}
            </select>
            <div className="absolute right-4 pointer-events-none flex items-center">
              {loading ? <Loader2 size={18} className="animate-spin text-gray-500" /> : <Search size={18} className="text-gray-400" />}
            </div>
         </div>
      </header>

      {/* Main Map View */}
      <main className="flex-1 relative w-full h-full">
         {error && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
               <div className="bg-red-50 text-red-600 px-6 py-4 rounded-xl shadow-lg border border-red-100 flex items-center gap-3">
                  <MapIcon size={24} />
                  <span>{error}</span>
               </div>
            </div>
         )}
         
         <AnimatePresence>
         {!elevationData && !error && loading && (
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               transition={{ duration: 0.3 }}
               className="absolute inset-0 z-20 flex items-center justify-center bg-[#E5E5E5]/80 backdrop-blur-sm pointer-events-none">
                <div className="flex flex-col items-center gap-4 text-gray-500">
                   <Loader2 size={48} className="animate-spin" />
                   <span className="font-mono text-sm tracking-widest uppercase">{loadingStage || 'Generating Terrain Model...'}</span>
                </div>
            </motion.div>
         )}
         </AnimatePresence>

         <AnimatePresence mode="wait">
         {elevationData && (
             <motion.div 
                key={locationName}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="w-full h-full absolute inset-0"
             >
                <Map3D data={elevationData} rivers={riversData} states={statesData} />
                {overlaysLoading && (
                   <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/30 backdrop-blur-sm text-white/80 text-xs font-mono px-3 py-1.5 rounded-full pointer-events-none">
                      <Loader2 size={12} className="animate-spin" />
                      Loading overlays...
                   </div>
                )}
                <div className="absolute top-32 left-6 pointer-events-none">
                    <h2 className="text-[5rem] leading-[0.85] font-serif font-black tracking-tighter text-gray-900/10 skew-x-[-5deg]">
                        {locationName.toUpperCase()}
                    </h2>
                </div>
             </motion.div>
         )}
         </AnimatePresence>
      </main>
    </div>
  );
}

