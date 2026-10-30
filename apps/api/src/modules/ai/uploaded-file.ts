/** Fichier reçu en multipart, gardé en mémoire (champs utilisés de l'objet fourni par multer). */
export interface UploadedFileInMemory {
  buffer: Buffer;
  originalname: string;
  size: number;
}
