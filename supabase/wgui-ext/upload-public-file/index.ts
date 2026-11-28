// Replaces wanderers-guide's upload-public-file when the functions container starts.
// The stock function refuses the upload unless the user has Patreon tier 1.
// Size, type, and category checks stay.

// @ts-ignore
import { serve } from 'std/server';
import { decode } from 'base64-arraybuffer';
import { connect, getPublicUser } from '../_shared/helpers.ts';
import { uniqueId } from '../_shared/upload-utils.ts';

// Length of the base64 string, about 2.25 MB of image bytes.
const MAX_SIZE = 3_000_000;

serve(async (req: Request) => {
  return await connect(req, async (client, body, token) => {
    let { data, category, type } = body as { data: string; category: string; type: string };
    if (typeof data !== 'string' || data.length > MAX_SIZE)
      return {
        status: 'error',
        message: 'File size too large',
      };
    if (!['png', 'jpeg', 'jpg', 'webp'].includes(type))
      return {
        status: 'error',
        message: 'Invalid type',
      };
    if (!['portraits', 'backgrounds'].includes(category))
      return {
        status: 'error',
        message: 'Invalid category',
      };

    const user = await getPublicUser(client, token);
    if (!user) {
      return {
        status: 'error',
        message: 'User not found',
      };
    }

    const storedType = type === 'jpg' ? 'jpeg' : type;
    const path = `${user.user_id}/${uniqueId(data, '', 0, 0)}.${storedType}`;
    const { data: uploadResult, error } = await client.storage.from(category).upload(path, decode(data), {
      contentType: `image/${storedType}`,
    });

    if (error || !uploadResult) {
      return {
        status: 'error',
        message: error?.message || 'Upload failed',
      };
    }

    const { data: urlResult } = client.storage.from(category).getPublicUrl(uploadResult.path);

    return {
      status: 'success',
      data: {
        url: urlResult.publicUrl,
      },
    };
  });
});
