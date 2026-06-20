import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadResult {
  key: string;
  url: string;
  isLocal: boolean;
}

@Injectable()
export class R2Service {
  private readonly logger = new Logger(R2Service.name);
  private readonly client: S3Client | null = null;
  private readonly bucket: string;
  private readonly accountId: string | null;
  private readonly publicUrl: string;
  private readonly localDir: string;
  private readonly isConfigured: boolean;

  constructor(private readonly config: ConfigService) {
    this.accountId = this.config.get<string>('R2_ACCOUNT_ID') ?? null;
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    this.bucket =
      this.config.get<string>('R2_BUCKET_NAME') ?? 'strong-auto-uploads';
    this.publicUrl =
      this.config.get<string>('R2_PUBLIC_URL') ??
      `https://pub-${this.accountId ?? 'unknown'}.r2.dev`;
    this.localDir = this.config.get<string>('LOCAL_STORAGE_DIR') ?? 'uploads';

    this.isConfigured = !!(this.accountId && accessKeyId && secretAccessKey);

    if (this.isConfigured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: accessKeyId!,
          secretAccessKey: secretAccessKey!,
        },
      });
      this.logger.log('R2 storage configured and ready');
    } else {
      this.logger.warn(
        'R2 env vars not set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). ' +
          'Falling back to local file storage. Files will NOT persist across deploys!',
      );
      // Ensure local dir exists
      const fullLocalPath = path.resolve(process.cwd(), this.localDir);
      if (!fs.existsSync(fullLocalPath)) {
        fs.mkdirSync(fullLocalPath, { recursive: true });
      }
    }
  }

  /**
   * Upload a file to R2 (or local fallback).
   */
  async upload(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<UploadResult> {
    if (this.isConfigured && this.client) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      this.logger.log(`Uploaded to R2: ${key}`);
      return {
        key,
        url: `${this.publicUrl}/${key}`,
        isLocal: false,
      };
    }

    // Local fallback
    const filePath = path.resolve(process.cwd(), this.localDir, key);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, buffer);
    this.logger.warn(`Saved locally (no R2): ${key}`);
    return {
      key,
      url: `/${this.localDir}/${key}`,
      isLocal: true,
    };
  }

  /**
   * Get a signed URL for reading a private object (R2 only).
   * Falls back to local path if R2 not configured.
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    if (this.isConfigured && this.client) {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      return awsGetSignedUrl(this.client, command, { expiresIn });
    }

    // Local fallback — return the relative path
    return `/${this.localDir}/${key}`;
  }

  /**
   * Get the public URL for an object (no signing).
   */
  getPublicUrl(key: string): string {
    if (this.isConfigured) {
      return `${this.publicUrl}/${key}`;
    }
    return `/${this.localDir}/${key}`;
  }

  /**
   * Delete an object from R2 (or local).
   */
  async delete(key: string): Promise<void> {
    if (this.isConfigured && this.client) {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      this.logger.log(`Deleted from R2: ${key}`);
      return;
    }

    // Local fallback
    const filePath = path.resolve(process.cwd(), this.localDir, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      this.logger.log(`Deleted local file: ${key}`);
    }
  }
}
