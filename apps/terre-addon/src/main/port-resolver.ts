/**
 * Terre 端口解析器
 * 
 * 根据 WebGAL Terre 的端口机制确定预览 URL
 * 参考: WebGAL_Terre/packages/terre2/src/main.ts:24, 116, 122
 */

/**
 * 获取 Terre 预览端口
 * 
 * - 若未设置 WEBGAL_PORT，默认 3001
 * - 若设置了 WEBGAL_PORT，实际端口为 Number(WEBGAL_PORT) + 1
 */
export function getPreviewPort(): number {
  const envPort = process.env.WEBGAL_PORT;
  
  if (!envPort) {
    return 3001; // 默认端口
  }
  
  const basePort = Number(envPort);
  if (isNaN(basePort)) {
    console.warn(`[PortResolver] Invalid WEBGAL_PORT: ${envPort}, using default 3001`);
    return 3001;
  }
  
  return basePort + 1;
}

/**
 * 构造预览 URL
 * 
 * @param scenePath 场景文件路径（可选），如 "game/scene/start.txt"
 * @returns 预览 URL，如 "http://localhost:3001#scene=start"
 */
export function buildPreviewUrl(scenePath?: string): string {
  const port = getPreviewPort();
  const baseUrl = `http://localhost:${port}`;
  
  if (!scenePath) {
    return baseUrl;
  }
  
  // 提取场景名（去除路径和扩展名）
  const sceneName = scenePath
    .replace(/^.*\//, '') // 去除路径
    .replace(/\.txt$/, ''); // 去除 .txt 扩展名
  
  return `${baseUrl}#scene=${sceneName}`;
}

