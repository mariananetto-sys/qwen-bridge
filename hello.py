"""
Módulo Hello World em Python.
Demonstra o uso de docstrings, variáveis e funções básicas.
"""

# Variáveis
saudacao = "Olá"
nome = "Mundo"

def dizer_ola(pessoa: str) -> str:
    """
    Retorna uma string de saudação para a pessoa especificada.

    Args:
        pessoa (str): O nome da pessoa a ser saudada.

    Returns:
        str: A mensagem de saudação formatada.
    """
    return f"{saudacao}, {pessoa}!"

if __name__ == "__main__":
    mensagem = dizer_ola(nome)
    print(mensagem)