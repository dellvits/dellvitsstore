'use client';
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="container page empty">
      <h1>A small bump in the road.</h1>
      <p>This page couldn’t load. Please try again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
