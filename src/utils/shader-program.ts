type UniLocs = {[name: string]: WebGLUniformLocation | null}
type AttrLocs = {[name: string]: number}

export default class ShaderProgram {
  public program: WebGLProgram;
  public uniLocs: UniLocs;
  public attrLocs: AttrLocs;

  constructor(
    private gl: WebGL2RenderingContext, 
    vertexShaderSource: string, 
    fragmentShaderSource: string,
    attributeLocations?: {[name: string]: number}
  ) {
    const vertexShader = compileShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = compileShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER);
    const program = linkShaders(gl, vertexShader, fragmentShader, attributeLocations);

    this.uniLocs = new Proxy(
      {} as UniLocs, 
      {
        get(target, name: string) {
          let v = target[name]
          if(v == undefined) {
            target[name] = v = gl.getUniformLocation(program, name)
          }
          return v
        }
      }
    )

    this.attrLocs = new Proxy(
      {} as AttrLocs,
      {
        get(target, name: string) {
          let v = target[name]
          if(v === undefined) {
            v = target[name] = gl.getAttribLocation(program, name)
          }
          return v
        }
      }
    )

    this.program = program;
  }

  use() {
    this.gl.useProgram(this.program);
  }

}

function compileShader(
  gl: WebGL2RenderingContext, 
  shaderSource: string, 
  shaderType: number,
) {
  const shader = gl.createShader(shaderType); 
  if(shader) {
    gl.shaderSource(shader, shaderSource);
    gl.compileShader(shader);
    
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS)

    if(compiled) {
      return shader;
    } else {
      const lastError = gl.getShaderInfoLog(shader); 
      // find line number from a string like "ERROR: 0:270: ...."
      const lineNumber = parseInt(lastError!.match(/ERROR: \d+:(\d+):/)?.[1] ?? "")
      // take 2 sourrounding lines from the source 
      const lines = shaderSource.split('\n')
      console.log(lines.length)
      const contextLines = 4; 
      const context = lines.splice(Math.max(0, lineNumber - 1 - contextLines), contextLines * 2 + 1)
      context[contextLines] += "  <------------ here"
      console.error('shader source context:\n', context.join('\n'))
      throw(new Error("Error when compiling shader:" + lastError))
    } 
  } else {
    throw(new Error("WebGL could not create shader object"))
  }
}

function linkShaders(
  gl: WebGL2RenderingContext, 
  vertexShader: WebGLShader, 
  fragmentShader: WebGLShader,
  attributeLocations?: {[name: string]: number}
) {
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  
  // Bind attribute locations if provided
  if (attributeLocations) {
    for (const [name, location] of Object.entries(attributeLocations)) {
      gl.bindAttribLocation(program, location, name);
    }
  }
  
  gl.linkProgram(program);

  // check validity of program
  if(!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw(new Error("Error when linking shader program:" + gl.getProgramInfoLog(program)))
  }

  return program;
}
