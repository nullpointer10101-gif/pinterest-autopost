import dynamic from 'next/dynamic';

const ReelOrbitApp = dynamic(() => import('../src/main.jsx'), {
  ssr: false,
});

export default function Page() {
  return <ReelOrbitApp />;
}
