import '../src/styles.css';

export const metadata = {
  title: 'Reel Orbit',
  description: 'Social automation command center for Instagram scraping, Pinterest publishing, and menswear engagement.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
