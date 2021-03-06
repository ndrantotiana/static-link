export { StaticFilesystem } from "./lib/static-filesystem"
export { StaticFilesystemCreator } from "./lib/creator"
export { IFileSystem, patchFilesystem } from "./lib/patch-filesystem"
export { IModule, IReadOnlySynchronousFileSystem, patchModuleLoader } from "./lib/patch-moduleloader"
export { calculateHash } from "./lib/common"