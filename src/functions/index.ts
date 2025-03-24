// src/functions/index.ts

// 関数定義の型
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

// 関数呼び出しの型
export interface FunctionCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// 関数結果の型
export interface FunctionResult {
  id: string;
  name: string;
  result: any;
  error?: string;
}

// 関数ハンドラの型
export type FunctionHandler = (args: Record<string, any>) => Promise<any>;

// 関数レジストリクラス
class FunctionRegistry {
  private functions: Map<string, { definition: FunctionDefinition; handler: FunctionHandler }> = new Map();

  // 関数の登録
  register(definition: FunctionDefinition, handler: FunctionHandler): void {
    this.functions.set(definition.name, { definition, handler });
  }

  // 登録された全ての関数定義を取得
  getAllDefinitions(): FunctionDefinition[] {
    return Array.from(this.functions.values()).map(f => f.definition);
  }

  // 関数の実行
  async execute(functionCall: FunctionCall): Promise<FunctionResult> {
    const func = this.functions.get(functionCall.name);
    
    if (!func) {
      return {
        id: functionCall.id,
        name: functionCall.name,
        result: null,
        error: `Function '${functionCall.name}' not found`
      };
    }

    try {
      const result = await func.handler(functionCall.arguments);
      return {
        id: functionCall.id,
        name: functionCall.name,
        result
      };
    } catch (error) {
      return {
        id: functionCall.id,
        name: functionCall.name,
        result: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// シングルトンインスタンス
export const functionRegistry = new FunctionRegistry();

// 天気関数の定義
const weatherFunctionDefinition: FunctionDefinition = {
  name: 'get_weather',
  description: '指定した場所の現在の天気情報を取得します。',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: '都市名や住所など、天気を知りたい場所',
      },
      units: {
        type: 'string',
        description: '温度の単位',
        enum: ['celsius', 'fahrenheit'],
      },
    },
    required: ['location'],
  },
};

// 天気関数のハンドラ
const weatherFunctionHandler: FunctionHandler = async (args) => {
  const { location, units = 'celsius' } = args;
  
  // モックデータを返す
  const mockWeatherData = {
    location,
    temperature: units === 'celsius' ? Math.floor(Math.random() * 15) + 15 : Math.floor(Math.random() * 30) + 60,
    condition: ['晴れ', '曇り', '雨', '雪', '霧'][Math.floor(Math.random() * 5)],
    humidity: Math.floor(Math.random() * 50) + 30,
    windSpeed: Math.floor(Math.random() * 20) + 5,
    units,
    timestamp: new Date().toISOString(),
  };
  
  // 遅延をシミュレート
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return mockWeatherData;
};

// 関数の登録
functionRegistry.register(weatherFunctionDefinition, weatherFunctionHandler);

// デバッグ用: 登録された関数を表示
console.log('登録された関数:', functionRegistry.getAllDefinitions().map(d => d.name));
