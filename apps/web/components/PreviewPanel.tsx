"use client";

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PreviewImage {
  url: string;
  type: 'facebook_sfw' | 'website_nsfw_paired' | 'website_only';
}

interface PreviewPanelProps {
  facebookContent: string;
  websiteContent: string;
  images: PreviewImage[];
  hashtags?: string[];
}

export function PreviewPanel({
  facebookContent,
  websiteContent,
  images,
  hashtags = [],
}: PreviewPanelProps) {
  const facebookImages = images.filter(img => img.type === 'facebook_sfw');
  const websiteImages = images.filter(
    img => img.type === 'website_nsfw_paired' || img.type === 'website_only'
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Facebook Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Facebook Preview (SFW)</CardTitle>
            <Badge variant="outline">Public</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Content */}
          <div className="prose prose-sm max-w-none bg-muted/30 p-4 rounded-md">
            {facebookContent ? (
              <div dangerouslySetInnerHTML={{ __html: facebookContent }} />
            ) : (
              <p className="text-muted-foreground italic">No Facebook content yet</p>
            )}
          </div>

          {/* Images */}
          {facebookImages.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Images ({facebookImages.length})</p>
              <div className="grid grid-cols-2 gap-2">
                {facebookImages.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-md overflow-hidden bg-muted">
                    <img
                      src={img.url}
                      alt={`Facebook image ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hashtags */}
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hashtags.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="pt-2 border-t text-xs text-muted-foreground">
            <p>Character count: {facebookContent.replace(/<[^>]*>/g, '').length}</p>
            <p>Estimated read time: {Math.ceil(facebookContent.split(' ').length / 200)} min</p>
          </div>
        </CardContent>
      </Card>

      {/* Website Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Website Preview (NSFW)</CardTitle>
            <Badge variant="destructive">18+</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Content */}
          <div className="prose prose-sm max-w-none bg-muted/30 p-4 rounded-md">
            {websiteContent ? (
              <div dangerouslySetInnerHTML={{ __html: websiteContent }} />
            ) : (
              <p className="text-muted-foreground italic">No website content yet</p>
            )}
          </div>

          {/* Images */}
          {websiteImages.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Images ({websiteImages.length})</p>
              <div className="grid grid-cols-2 gap-2">
                {websiteImages.map((img, i) => (
                  <div key={i} className="relative aspect-square rounded-md overflow-hidden bg-muted">
                    <img
                      src={img.url}
                      alt={`Website image ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 right-2">
                      <Badge variant="destructive" className="text-xs">
                        {img.type === 'website_nsfw_paired' ? 'Paired' : 'Website Only'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hashtags */}
          {hashtags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {hashtags.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="pt-2 border-t text-xs text-muted-foreground">
            <p>Character count: {websiteContent.replace(/<[^>]*>/g, '').length}</p>
            <p>Estimated read time: {Math.ceil(websiteContent.split(' ').length / 200)} min</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
