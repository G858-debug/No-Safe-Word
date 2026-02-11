export default function StoryPage({ params }: { params: { slug: string } }) {
  return (
    <div className="min-h-screen p-8">
      <h1 className="text-4xl font-bold mb-4">Story: {params.slug}</h1>
      <p className="text-gray-600">Story detail page - coming soon</p>
    </div>
  );
}
