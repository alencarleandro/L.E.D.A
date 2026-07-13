# Manual de endpoint health check

Use este roteiro ao pedir a outro agente para implementar uma rota de saúde em uma aplicação monitorada pela L.E.D.A.

## Prompt para implementação

Crie um endpoint HTTP de health check para esta aplicação.

### Objetivo

Permitir que a ferramenta L.E.D.A monitore se a aplicação está disponível e pronta para atender requisições.

### Endpoint principal

`GET /health`

### Requisitos de resposta quando saudável

- Retornar HTTP `200`.
- Retornar JSON.
- Incluir no mínimo:

```json
{
  "status": "UP",
  "service": "<nome-da-aplicacao>",
  "timestamp": "<data ISO 8601>"
}
```

### Requisitos de resposta quando houver falha

- Retornar HTTP `503`.
- Retornar JSON.
- Incluir:

```json
{
  "status": "DOWN",
  "service": "<nome-da-aplicacao>",
  "timestamp": "<data ISO 8601>",
  "checks": {
    "<dependencia>": "DOWN"
  }
}
```

### Dependências que devem ser validadas

O endpoint deve validar as dependências essenciais para a aplicação atender:

- Banco de dados, se houver.
- Cache/Redis, se for obrigatório.
- Filas, APIs externas ou armazenamento, somente se forem indispensáveis para a operação principal.

### Boas práticas

- Cada checagem deve ter timeout curto; não deixar o endpoint travar.
- Não expor senhas, tokens, strings de conexão, stack traces ou dados sensíveis.
- Retornar o cabeçalho `Cache-Control: no-store`.
- Não exigir autenticação se a L.E.D.A precisar acessá-lo localmente; se for público, restringir por rede, VPN, firewall ou token específico.
- Manter a resposta pequena e rápida.
- Criar testes para cenário saudável e cenário de dependência indisponível.

### Endpoints complementares

Separar, se fizer sentido:

- `GET /health/live`: apenas confirma que o processo da aplicação está rodando. Retorna `200` enquanto o processo estiver vivo.
- `GET /health/ready`: confirma que a aplicação está pronta para atender, validando dependências essenciais. Retorna `503` se algo crítico falhar.

### Configuração recomendada na L.E.D.A

- URL: `/health/ready`, se existir; caso contrário, `/health`.
- Status HTTP esperado: `200`.
- Texto esperado: `UP`.
