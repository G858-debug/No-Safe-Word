"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function CreateStoryPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalParts, setTotalParts] = useState(1);
  const [hashtag, setHashtag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/stories/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          total_parts: totalParts,
          hashtag: hashtag.startsWith('#') ? hashtag : `#${hashtag}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create story');
      }

      const { series } = await res.json();
      router.push(`/dashboard/stories/${series.id}`);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to create story');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Create New Story Series</h1>
        <p className="text-muted-foreground mt-2">
          Start a new story series. You can add parts, characters, and images after creation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Story Details</CardTitle>
          <CardDescription>Basic information about your story series</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter story title"
                required
              />
              <p className="text-xs text-muted-foreground">
                This will be the main title of your story series
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of the story"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Optional description for internal reference
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="totalParts">Number of Parts *</Label>
              <Input
                id="totalParts"
                type="number"
                min={1}
                max={50}
                value={totalParts}
                onChange={(e) => setTotalParts(parseInt(e.target.value) || 1)}
                required
              />
              <p className="text-xs text-muted-foreground">
                How many parts/chapters will this story have?
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hashtag">Hashtag</Label>
              <Input
                id="hashtag"
                value={hashtag}
                onChange={(e) => setHashtag(e.target.value)}
                placeholder="#YourStoryTag"
              />
              <p className="text-xs text-muted-foreground">
                Main hashtag for social media (without the #)
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={loading}>
                {loading ? 'Creating...' : 'Create Story Series'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard/stories')}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What&apos;s Next?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>After creating the story series, you&apos;ll be able to:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Add characters to the story</li>
            <li>Generate character portraits</li>
            <li>Write story content for each part</li>
            <li>Generate scene images</li>
            <li>Review and publish to Facebook</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
