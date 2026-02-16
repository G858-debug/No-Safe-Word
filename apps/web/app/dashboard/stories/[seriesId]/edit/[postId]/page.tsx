"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RichTextEditor } from '@/components/RichTextEditor';
import { PreviewPanel } from '@/components/PreviewPanel';
import { Sparkles, Save, Loader2 } from 'lucide-react';

export default function EditPostPage() {
  const params = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [facebookContent, setFacebookContent] = useState('');
  const [websiteContent, setWebsiteContent] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState('');

  useEffect(() => {
    loadPost();
  }, []);

  async function loadPost() {
    try {
      const res = await fetch(`/api/stories/posts/${params.postId}`);
      if (!res.ok) throw new Error('Failed to load post');

      const { post } = await res.json();
      setTitle(post.title);
      setFacebookContent(post.facebook_content);
      setWebsiteContent(post.website_content);
      setHashtags(post.hashtags || []);
      // Load images would go here
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/stories/posts/${params.postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          facebook_content: facebookContent,
          website_content: websiteContent,
          hashtags,
        }),
      });

      if (!res.ok) throw new Error('Failed to save');

      // Show success message
      alert('Saved successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function getAISuggestions(type: 'facebook' | 'website') {
    setAiLoading(true);
    setAiSuggestion('');

    try {
      const res = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: type === 'facebook' ? facebookContent : websiteContent,
          type,
        }),
      });

      if (!res.ok) throw new Error('Failed to get suggestions');

      const { suggestion } = await res.json();
      setAiSuggestion(suggestion);
    } catch (err) {
      console.error(err);
      alert('Failed to get AI suggestions');
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Edit Story Post</h1>
          <p className="text-muted-foreground">Edit content for both Facebook and website</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>

      <Tabs defaultValue="edit" className="space-y-4">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="space-y-6">
          {/* Title */}
          <Card>
            <CardHeader>
              <CardTitle>Post Title</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter post title"
              />
            </CardContent>
          </Card>

          {/* Facebook Content */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Facebook Content (SFW)</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => getAISuggestions('facebook')}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  AI Suggestions
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RichTextEditor
                content={facebookContent}
                onChange={setFacebookContent}
                placeholder="Write your Facebook post content..."
              />
            </CardContent>
          </Card>

          {/* Website Content */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Website Content (NSFW)</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => getAISuggestions('website')}
                  disabled={aiLoading}
                >
                  {aiLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-4 w-4" />
                  )}
                  AI Suggestions
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RichTextEditor
                content={websiteContent}
                onChange={setWebsiteContent}
                placeholder="Write your website content..."
              />
            </CardContent>
          </Card>

          {/* AI Suggestions Panel */}
          {aiSuggestion && (
            <Card>
              <CardHeader>
                <CardTitle>AI Suggestions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose prose-sm max-w-none bg-muted/50 p-4 rounded-md">
                  {aiSuggestion}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="preview">
          <PreviewPanel
            facebookContent={facebookContent}
            websiteContent={websiteContent}
            images={images}
            hashtags={hashtags}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
