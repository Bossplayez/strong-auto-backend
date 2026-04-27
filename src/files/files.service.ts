import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async upload(
    file: Express.Multer.File,
    createdByUserId?: string,
  ): Promise<{ id: string; url: string; mimeType: string; size: number }> {
    // Validate
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type "${file.mimetype}" is not allowed. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(`File size exceeds maximum of 10MB`);
    }

    // Generate unique key
    const ext = file.originalname.split('.').pop() ?? 'bin';
    const uuid = crypto.randomUUID();
    const storageKey = `uploads/${new Date().toISOString().slice(0, 7)}/${uuid}.${ext}`;
    const bucket = this.config.get('STORAGE_BUCKET', 'strong-auto-uploads');

    // Checksum
    const checksum = crypto
      .createHash('md5')
      .update(file.buffer)
      .digest('hex');

    // TODO: Upload to S3/MinIO/R2 using storageKey
    // For now, we store the record and assume local/mock storage
    this.logger.log(`Uploading file: ${file.originalname} → ${storageKey}`);

    const record = await this.prisma.file.create({
      data: {
        bucket,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        checksum,
        createdByUserId: createdByUserId ?? null,
      },
    });

    const cdnBase = this.config.get(
      'CDN_BASE_URL',
      'https://cdn.strongauto.com',
    );

    return {
      id: record.id,
      url: `${cdnBase}/${storageKey}`,
      mimeType: record.mimeType ?? file.mimetype,
      size: record.size,
    };
  }

  async findById(id: string) {
    const file = await this.prisma.file.findUnique({ where: { id } });

    if (!file) {
      throw new NotFoundException(`File "${id}" not found`);
    }

    const cdnBase = this.config.get(
      'CDN_BASE_URL',
      'https://cdn.strongauto.com',
    );

    return {
      ...file,
      url: `${cdnBase}/${file.storageKey}`,
    };
  }
}
