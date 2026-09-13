import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="container page empty">
      <h1>That turn led us elsewhere.</h1>
      <p>We couldn’t find this page. Let’s get you back to something good.</p>
      <Link href="/" className="button">
        Back to Dellvit
      </Link>
    </div>
  );
}
