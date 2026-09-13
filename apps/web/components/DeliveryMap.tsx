'use client';
import { useRef, useEffect, useState } from 'react';
import 'leaflet/dist/leaflet.css';
export default function DeliveryMap({
  lat,
  lng,
  pickup,
  onChange,
}: {
  lat: number;
  lng: number;
  pickup?: { lat: number; lng: number };
  onChange?: (lat: number, lng: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [routeState, setRouteState] = useState('');
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  useEffect(() => {
    let disposed = false;
    let map: import('leaflet').Map | undefined;
    const controller = new AbortController();
    async function setup() {
      const L = await import('leaflet');
      if (disposed || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView([lat, lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      const marker = L.circleMarker([lat, lng], {
        radius: 9,
        color: '#fff',
        weight: 3,
        fillColor: '#d91e45',
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip('Delivery location');
      if (changeRef.current)
        map.on('click', (e) => {
          marker.setLatLng(e.latlng);
          changeRef.current?.(e.latlng.lat, e.latlng.lng);
        });
      if (pickup) {
        L.circleMarker([pickup.lat, pickup.lng], {
          radius: 9,
          color: '#fff',
          weight: 3,
          fillColor: '#f79a36',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindTooltip('Pickup location');
        const bounds = L.latLngBounds([
          [lat, lng],
          [pickup.lat, pickup.lng],
        ]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
        setRouteState('Loading road directions…');
        try {
          const r = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${lng},${lat}?overview=full&geometries=geojson`,
            { signal: controller.signal },
          );
          if (!r.ok) throw Error();
          const d = await r.json();
          if (disposed) return;
          if (!d.routes?.[0]) throw Error();
          L.geoJSON(d.routes[0].geometry, { style: { color: '#d91e45', weight: 5 } }).addTo(map);
          setRouteState(
            `${(d.routes[0].distance / 1000).toFixed(1)} km road route · approximately ${Math.ceil(d.routes[0].duration / 60)} min driving`,
          );
        } catch {
          if (!disposed) {
            L.polyline(
              [
                [pickup.lat, pickup.lng],
                [lat, lng],
              ],
              { color: '#d91e45', dashArray: '7 8' },
            ).addTo(map);
            setRouteState(
              'Road routing unavailable. Dashed line connects the two locations; use navigation for directions.',
            );
          }
        }
      }
      setTimeout(() => map?.invalidateSize(), 100);
    }
    setup();
    return () => {
      disposed = true;
      controller.abort();
      map?.remove();
    };
  }, [lat, lng, pickup?.lat, pickup?.lng]);
  return (
    <div className="map-wrap">
      <div
        ref={ref}
        className="map"
        role="application"
        aria-label={pickup ? 'Pickup to delivery route' : 'Choose your delivery pin on the map'}
      />
      {onChange && (
        <p className="small-muted">
          Tap the map to set your delivery pin. You can also enter coordinates below.
        </p>
      )}
      {routeState && <p className="small-muted">{routeState}</p>}
      <p className="small-muted">
        Map tiles and directions use OpenStreetMap / OSRM and require internet access.
      </p>
    </div>
  );
}
